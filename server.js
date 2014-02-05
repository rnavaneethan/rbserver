var Q = require('q'),
  connect = require('connect'),
  express = require('express'),
  http = require('http'),
  qs = require('querystring'),
  _ = require('lodash'),
  dbu = new require('./dbutils')();

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
  
app.use('/api/v1', apiv1);

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
    result = getResultTemplate();
  var def = dbu.update(user, email, lat, lon).then(function(r){
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
        dbu.update(user, email, lat, lon).then(function(r){
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
  _notify(to, m).then(function(r) {
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
    console.log('Got GCM list ' + JSON.stringify(mapGCM));
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
      console.log('Added request ' + sRequest);
      //send the request to all valid GCM users
      _(mapGCM).values().uniq().each(function(v){
        sendGCM(v, sRequest);
      });
      result.code = 'ok';
      result.msg = ''; 
      res.render('default',result);
    }, function(){
      result.msg = 'Unable to add this request to the table';
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
    var GCMInfo = _.pluck(info, 'id','user','accuser');
    _.extend(GCMInfo, {type: 'rideaccept'});
    sendGCM(info.reqgcmID, JSON.stringify(GCMInfo));
    result.code = 'ok';result.msg='';
  }, function (s) {
    result.msg = s;
  }).finally(function () {
    res.render('default', result);
  });
}

function sendGCM(gcmID, msg) {
  
  var o = {
    host: 'android.googleapis.com',
    port: 443,
    path: '/gcm/send',
    method: 'GET',
    headers: {
      'Authorization': 'key=AIzaSyAzeiq8Esbgx1FaFFocO0zN1-jCTcqMH-s'
    }
  }, d = Q.defer();
  var params = qs.stringify({registration_id: gcmID, 'data.message': msg});
  o.path += '?' + params;
  console.log('GCM: ' + o.path);
  var req = http.request(o, function(res) {
    res.on('end', function () {
      d.resolve('Successfully sent GCM request');
    });
  }).on('error', function () {
    d.reject('Unable to send GCM request');
  });
  req.end();
  return d.promise;
}

