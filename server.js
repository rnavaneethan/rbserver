var mongoose= require('mongoose-q')(),
  Q = require('q'),
  connect = require('connect'),
  express = require('express'),
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
    'email' : {type: String, select: true, unique: true, index: true, required: true},
    'phone': {type: String},
    'lat' : {type: Number, default: "0.0"},
    'lon' : {type: Number, default: "0.0"}
  });
  userSchema.plugin(createdModifiedPlugin, {index: true});
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
  }).finally(function(r) {
    result.msg = r;
    response.render('update', result);
  });
}

function _update(u, e, lat, lon) {
  var msg = "", bFailed = false;
  var d = Q.defer();
  if(u.length === 0 ) {
    msg = "Username is must!";
    bFailed = true;
  } else if (e.length === 0) {
    msg = "Please send valid email address!";
    bFailed = true;
  } else if (lat.length === 0 || lon.length === 0) {
    bFailed = true;
  }
  if(bFailed) {
    msg = msg || 'Invalid params!';
    d.reject(msg);
  }
  
  //update to DB
  model.findOneAndUpdateQ({name: u}, {name: u, email: e, lat: lat, lon: lon}, {upsert: true}).then(function (c) {
    d.resolve('Updated');
    return;
  });
    
  return d.promise;
}

function list(req, response, next) {
  _list().done(function(r){

      response.render('list',r);
  });
}

function _list(q) {
  var result = {
    "code": "ok",
    "msg":"",
    "users": {}
  };
  var d = Q.defer();
  model.findQ().then(function(doc){
    console.log(JSON.stringify(doc));
    result.users = _.map(doc, function (v) { return {'name': v.name, 'email': v.email, 'lat': v.lat, 'lon': v.lon}; });
    d.resolve(result);
    return;
  });
  return d.promise;
}
function register(req, response, next) {
  _register().then(function(r) {
    response.render('register', r);
  });
}

function _register() {
  var d = Q.defer();
  return d.promise;
}