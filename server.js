var mongoose= require('mongoose-q')(),
  Q = require('q'),
  connect = require('connect'),
  express = require('express'),
  http = require('http'),
  qs = require('querystring'),
  createdModifiedPlugin = require('mongoose-createdmodified').createdModifiedPlugin,
  _ = require('lodash');
  
//config const
var server = 'localhost',
  dbname = 'rb',
  connStr = 'mongodb://'+server+'/'+db,
  port = 3000;
  
//create handler for api
var apiv1 = connect()
  .use(connect.query())   //use query processing middleware
  .use('/register', register)
  .use('/notify', notify)
  .use('/update', update)
  .use('/list', list);
  
/*create connection to db*/
mongoose.connect(connStr);
var db = mongoose.connection, userSchema, model;
db.on('error', console.error.bind(console, 'connection error:'));
db.once('open', function cb(){
  dbInit();
	startServer();
});

function dbInit() {
  userSchema = new mongoose.Schema({
    'name' : {type: String, select: true, unique: true, dropDups: true, index: true, required: true},
    'email' : {type: String, select: true, unique: true, index: true, required: true, dropDups: true},
    'gcmID' : {type: String, unique: true, required: true},
    'phone': {type: String},
    'loc': []
  });
  userSchema.plugin(createdModifiedPlugin, {index: true});
  userSchema.index({'loc': '2d'});
  model = db.model('user', userSchema);
}
/*start connect server here*/
function startServer() {
  var app = express();
  app.configure(function () {
    app.set('views', __dirname + '/views');
    app.set('view engine', 'ejs');
    app.use(express.compress());
    app.use(express.favicon());
    app.use(express.logger('dev'));
    app.use(connect.urlencoded());
    app.use(connect.json());
    app.use(app.router);
  });
  app.use('/api/v1', apiv1)
    .listen(port);
}


function update(req, response, next) {
  var user = req.query.user || '',
    email = req.query.email || '',
    lat = req.query.lat || '',
    lon = req.query.lon || '',
    result = {
      'code': 'fail',
      'msg':'unexpected result'
    };
  _update(user, email, lat, lon).then(function(r){
    result.code = 'ok';
    result.msg = r;
  }, function(r) {
    result.msg = r;
  }).finally(function() {
    response.render('update', result);
  });
}

function _update(u, e, lat, lon) {
  var msg = "", bFailed = false;
  var d = Q.defer();
  if(u.length === 0 ) {
    msg = "Username is must!";
    bFailed = true;
  } /*else if (e.length === 0) {
    msg = "Please send valid email address!";
    bFailed = true;
  } */else if (lat.length === 0 || lon.length === 0) {
    bFailed = true;
  }
  if(bFailed) {
    msg = msg || 'Invalid params!';
    d.reject(msg);
  }
  
  //only if user is in DB, update it
  model.where({name: u}).findOneQ().then(function(doc){
    //update to DB
    model.findOneAndUpdateQ({name: u}, {name: u, email: e, 'loc': [lon, lat]}, {new: true}).then(function (doc) {
      d.resolve('Updated');
    }, function(e) {
      d.reject('Failed to update!');
    });
  }, function() {
    d.reject('User is not found!');
  });
  
  return d.promise;
}

function list(req, response, next) {
  var result = {
    'code':'fail',
    'msg':''
  };
  _list().then(function(r){
      result.code = 'ok';
      result.users = r;
  }, function(r) {
    //failure handler
    result.code = 'fail';
    result.msg = r;
  }).finally(function () {
    response.render('list',result);
  });
}

function _list(q) {
  var d = Q.defer();
  model.findQ().then(function(doc){
    //console.log(JSON.stringify(doc));
    //map and extract only necessary fields
    var u = _.map(doc, function (v) { return {'name': v.name, 'email': v.email, 'loc': v.loc, 'lon': v.loc ? v.loc[0] : "0", 'lat': v.loc ? v.loc[1] : "0"}; });
    d.resolve(u);
    return;
  });
  return d.promise;
}
function register(req, response, next) {
  var user = req.query.user || '',
    email = req.query.email || '',
    phone = req.query.phone || '',
    gcm = req.query.gcm || '',
    result = {
      'code': 'fail',
      'msg':'unexpected result'
    };
  _register(user, email, phone, gcm).then(function(r) {
    result.code = "ok";
    result.msg = r;
  }, function (r) {
    result.msg = r;
  }).finally(function () {
    response.render('register', result);
  });
}

function _register(u, e, p, gcm) {
  var d = Q.defer(), bFound = false, bFailed = false;
  if(u.length === 0 ) {
    msg = "Username is must!";
    bFailed = true;
  } else if (e.length === 0) {
    msg = "Please send valid email address!";
    bFailed = true;
  } else if (p.length === 0) {
    bFailed = true;
    msg = 'Give valid phone number';
  } else if(gcm.length === 0 ) {
    bFailed = true;
    msg = "GCM ID is missing"
  }
  if(bFailed) {
    msg = msg || 'Invalid params!';
    d.reject(msg);
  }
  
  //Find if the user is available
  //Search by name / email address
  var qu = model.where({name: u}).or({email: e}).findOneQ().then(function(doc) {
    if(!doc) {
      //let's insert the new user
      var user = new model();
      user.name = u;
      user.email = e;
      user.phone = p;
      user.gcmID = gcm;
      user.save(function(e) {
        if (e) {
          console.log(e);
          d.reject('Failed to save');
        }
        d.resolve('User Created');
      });
    } else {
      d.reject('User/email already exist');
    }
  }, function(e) {
    d.reject('Unexpected DB error. Try again!');
  });
  return d.promise;
}

function _notify(to, m) {
  var d = Q.defer(), bFailed = false, msg = '';
  if (!to.length) {
    bFailed = true;
    msg = 'Need valid email address of recipient';
  }else if (!m.length) {
    bFailed = true;
    msg = 'Empty message';
  }
  if( bFailed ) {
    d.reject(msg);
  }
  
  //check for presence of recipient
  model.findQ({email: to}).then(function (doc) {
    if(!doc.length) {
      d.reject('Recipient is not found');
    }
    //Ensure that gcmID is there and then send message
    console.log(JSON.stringify(doc));
    sendGCM(doc[0].gcmID,  m);
    d.resolve('sent');
  }, function (e) {
    d.reject('Recipient not found');
  });
  return d.promise;
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
    response.render('register', result);
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
