var mongoose= require('mongoose-q')(),
  Q = require('q'),
  connect = require('connect'),
  express = require('express'),
  _ = require('lodash');
  
//config const
var server = 'localhost',
  dbname = 'rb',
  connStr = 'mongodb://'+server+'/'+db,
  port = 3000;
  
//create handler for api
var apiv1 = connect()
  .use(connect.query())   //use query processing middleware
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
    'name' : {'type': String, select: true, unique: true, dropDups: true},
    'lat' : {type: String},
    'lon' : {type: String}
  });
  model = db.model('user', userSchema);
}
/*start connect server here*/
function startServer() {
  var app = express();
  app.configure(function () {
    app.set('views', __dirname + '/views');
    app.set('view engine', 'ejs');
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
    lat = req.query.lat || '',
    lon = req.query.lon || '',
    code = 0, msg = "";
  _update(user, lat, lon).then(function(r) {
    response.render('update', r);
  });
  
}

function _update(u, lat, lon) {
  var result = {
    "code": "fail",
    "msg" :""
  }
  var d = Q.defer();
  if( u.length === 0|| lat.length === 0 || lon.length === 0) {
    result.msg = "Invalid params!";
    d.resolve(result);
  }
  
  //update to DB
  model.findOneAndUpdateQ({name: u}, {name: u, lat: lat, lon: lon}, {upsert: true}).then(function (c) {
    
    result.code = "ok";
    d.resolve(result);
    return;
  });
    
  return d.promise;
}

function list(req, response, next) {
  _list().then(function(r){

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
    result.users = _.map(doc, function (v) { return {'name': v.name, 'lat': v.lat, 'lon': v.lon}; });
    d.resolve(result);
    return;
  });
  return d.promise;
}
