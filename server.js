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
  
  //only if user is in DB, update it
  model.findOneQ({name: u}).then(function(e, doc){
    console.log('Err'+ JSON.stringify(e));
    console.log('Doc' + doc);
    if(e || !doc ) {
      d.reject('User is not found!');
      return;  
    }
    //update to DB
    model.findOneAndUpdateQ({name: u}, {name: u, email: e, lat: lat, lon: lon}, {new: true}).then(function (e, doc) {
      d.resolve('Updated');
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
    var u = _.map(doc, function (v) { return {'name': v.name, 'email': v.email, 'lat': v.lat, 'lon': v.lon}; });
    d.resolve(u);
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