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
      'msg':'unexpected result'
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
  .use(apiErrHandler);  //API error handler
  
app.use('/api/v1', apiv1);

function apiErrHandler(err, req, response, next) {
  console.error(err.stack);
  response.render('default', _result);
}

function list(req, res, n) {
  //Extract the query param and pass it on to the DB query handler
  var srch = req.query.search || '',
    lat = req.query.lat || 0,
    lon = req.query.lon || 0,
    since = req.query.since || 0,
    result = _result;
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
    result = _result;
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
    lat = req.query.lat || 0,
    lon = req.query.lon || 0,
    result = _result;
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
    result = {
      code: 'fail',
      msg: '' 
    };
  _notify(to, m).then(function(r) {
    result.code = "ok";
    result.msg = r;
  }, function (r) {
    result.msg = r;
  }).finally(function () {
    response.render('default', result);
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
  };
  var params = qs.stringify({registration_id: gcmID, 'data.message': msg});
  o.path += '?' + params;
  console.log('GCM: ' + o.path);
  http.request(o, function() {
  }).on('error', function () {
  });
  return;
}

