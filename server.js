var Q = require('q'),
  connect = require('connect'),
  express = require('express'),
  http = require('http'),
  qs = require('querystring'),
  _ = require('lodash'),
  gcm = require('node-gcm'),
  dbu = new require('./dbutils')(),
  gcmKey = 'AIzaSyAzeiq8Esbgx1FaFFocO0zN1-jCTcqMH-s',
  rq = require('request'),
  ffmpeg = require('fluent-ffmpeg');

/*Configurations*/
var port = 3000,
  dbHost = 'localhost', dbName = 'rb',
  _result = {
      'code': 'fail',
      'msg':'unexpected result',
      'ts':0
    };

/*start the server*/
var app = express();
app.configure(function () {
  app.set('views', __dirname + '/views');
  app.set('view engine', 'ejs');
  app.enable('trust proxy');
  app.use(express.compress());
  app.use(express.favicon());
  app.use(express.logger());
  app.use(express.json());
  app.use(express.urlencoded());    
  app.use(app.router);
  
  //connect to DB
  dbu.init(dbHost,dbName);
}).listen(port);

/*set path for API
create handler for api*/
var apiv1 = connect()
  .use(connect.query())   //use query processing middleware
  .use('/register', register)
  .use('/notify', notify)
  .use('/update', update)
  .use('/list', list)
  .use('/riderequest',riderequest)
  .use('/rideaccept',rideaccept)
  .use(apiErrHandler);  //API error handler
  
var apiVideo = connect()
  .use(connect.query())
  .use('/getvideo',getvideo)
  .use(apiErrHandler);  //generic error handler
  
app.use('/api/v1', apiv1);
app.use('/video', apiVideo);

function getvideo(req, res, n) {
  var token = req.query.token || '',
    reqURL = 'http://webmailbb.netzero.net/cgi-bin/videomail.cgi?command=get_video&token=' + token;
  //build the get request
  if(token.length) {
    console.log('got valid token ' + reqURL);
    //create pipe for input stream
    var proc = new ffmpeg({source: rq.get(reqURL), nolog:true})
      .withVideoCodec('libx264')
      .withAudioCodec('libfaac')
       .toFormat('mp4')
      .writeToStream(res, {end:true}, function(retcode, error){
      console.log('file has been converted succesfully');
    });
  }
}

function apiErrHandler(err, req, response, next) {
  console.error(err.stack);
  response.render('default', _result);
}

function getResultTemplate() {
  return _.extend(_result, {'ts': new Date().getTime()});
}
function list(req, res, n) {
  //Extract the query param and pass it on to the DB query handler
  var srch = req.query.search || '',
    lat = req.query.lat || 0,
    lon = req.query.lon || 0,
    since = parseInt(req.query.since, 10) || 0,
    result = getResultTemplate() ;
  dbu.list(srch, lat, lon, since).then(function (r) {
    result.code = 'ok';
    result.msg = '';
    result.users = r;
  }, function (r) {
    result.code = 'fail';
    result.msg = 'Unable to query from DB';
  }).finally(function () {
    res.render('list', result);
  });  
}

function register(req, res, n) {
  var user = req.query.user || '',
    email = req.query.email || '',
    phone = req.query.phone || '',
    gcm = req.query.gcm || '',
    result = getResultTemplate();
  dbu.register(user, email, phone, gcm).then(function(r) {
    result.code = "ok";
    result.msg = r;
  }, function (r) {
    result.msg = r;
  }).finally(function () {
    res.render('default', result);
  });
}

function update(req, res, n) {
  var user = req.query.user || '',
    email = req.query.email || '',
    lat = parseFloat(req.query.lat) || 0,
    lon = parseFloat(req.query.lon) || 0,
    gcm = req.query.gcm || '',
    result = getResultTemplate();
  var def = dbu.update(user, email, lat, lon, gcm).then(function(r){
    result.code = 'ok';
    result.msg = r;
  }, function(r) {
    result.msg = r;
  });
  
  /*def.finally(function() {
    res.render('default', result);
  })*/
  def.finally(function () {
    console.log(result.msg);
    if(result.msg === 'USER_NOT_FOUND') {
      dbu.register(user).then(function () {
        dbu.update(user, email, lat, lon,gcm).then(function(r){
          result.code = 'ok';
          result.msg = r;
        }, function(r) {
          result.msg = r;
        }).finally(function () {
          res.render('default', result);
        });
    	}, function (r) {
    	  rseult.msg = 'Failed to update';
    	  res.render('default', result);
    	});
    } else {
      res.render('default', result);
    }
  });
}

function notify(req, response, next) {
  var to = req.query.to || '',
    m = req.query.msg || '',
    result = getResultTemplate();
  sendGCM([to], m).then(function(r) {
    result.code = "ok";
    result.msg = r;
  }, function (r) {
    result.msg = r;
  }).finally(function () {
    response.render('default', result);
  });
}

function riderequest(req, res, next) {
  var user = req.query.user || '',
    from = _((req.query.from || ',').split(',')).map(function(n) {var v = parseFloat(n); return (_.isNumber(v) && !_.isNaN(v) ) ? v : 0;}).value(), //[lon, lat]
    to = _((req.query.to || ',').split(',')).map(function(n) {var v = parseFloat(n); return (_.isNumber(v) && !_.isNaN(v) ) ? v : 0;}).value(),
    result = getResultTemplate();
  //validate input field
  if(!user.length || from[0] === 0 || from[1] === 0 || to[0] === 0 || to[1] === 0 ) {
    result.msg = 'Invalid params';
    res.render('default', result);
    return;
  }
  dbu.getValidGCMUsers().then(function(mapGCM) {
    
    //The requested user should have valid GCMID
    if(!_(mapGCM).has(user)) {
      result.msg = "User doesn't have valid GCMID. Please re-register";
      res.render('default', result);
      return;
    }
    //Try to add request to the request table
    dbu.addRequest(user, from, to).then(function(reqInfo){
      //Added request successfully to the table      
      _.extend(reqInfo, {'type':'riderequest'});
      var sRequest = JSON.stringify(reqInfo);
      mapGCM = _(mapGCM).omit(user).values().uniq().compact().value();
      //send the request to all valid GCM users
      sendGCM(mapGCM, sRequest).then(function (s) {
        result.code = 'ok';
        result.msg = s;
      }, function (s) {
        result.msg = s;
      }).finally(function () {
        res.render('default', result);
      });
    }, function(s){
      result.msg = JSON.stringify(s);
      res.render('default',result);  
    });
    
  }, function(){
    console.log('Failed to get GCM list');
    result.msg = 'Unexpected DB error';
    res.render('default',result);
  });  
}

function rideaccept(req, res, next) {
  var user = req.query.user || '',
    id = req.query.id || '',
    result = getResultTemplate();
  //validate input field
  if(!user.length || !id.length ) {
    result.msg = 'Invalid params';
    res.render('default', result);
    return;
  }
  
  dbu.acceptRequest(user, id).then(function (info) {
    //Let's send GCM for requestor
    var GCMInfo = _.pick(info, 'id','user','accuser');
    _.extend(GCMInfo, {type: 'rideaccept'});
    sendGCM([info.reqgcmID], JSON.stringify(GCMInfo));
    result.code = 'ok';result.msg='';
  }, function (s) {
    console.log(s);
    result.msg = s;
  }).finally(function () {
    res.render('default', result);
  });
}

function sendGCM(gcmIDs, msg) {
  var d = Q.defer();
  //Do input validation
  if(!gcmIDs.length || !msg.length ) {
    d.reject('invalid params!');
  }
  
  console.log('Sending GCM Request MSG: ' + msg + ' IDs: ' + JSON.stringify(gcmIDs));
  //Let's build GCM request and send it
  var message = new gcm.Message({
    data:{
      'message': msg
    },
    delayWhileIdle: true,
    timeToLive: 3/*,
    dry_run: true*/
  }), sender = new gcm.Sender(gcmKey);
  
  sender.send(message, gcmIDs, 1, function (e, res) {
    e && console.log('Error ' + e);
    res && console.log('result ' + JSON.stringify(res));
    /*e && d.reject('Failed to send GCM ' + JSON.stringify(e));
    res && d.resolve('Successfully sent GCM ' + JSON.stringify(res));*/
    e && d.reject('Failed to send GCM');
    res && d.resolve('Successfully sent GCM');
    d.resolve();
  });
  return d.promise;
}

