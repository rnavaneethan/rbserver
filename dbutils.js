var mongoose= require('mongoose-q')(),
  Q = require('q'),
  createdModifiedPlugin = require('mongoose-createdmodified').createdModifiedPlugin,
  _ = require('lodash');

function DBWrapper() {
  var dbHost = 'localhost', 
    dbName = 'rb',
    bInit = false,
    db = null, model = null,
    userSchema = new mongoose.Schema({
      'name' : {type: String, select: true, unique: true, dropDups: true, index: true, required: true},
      'email' : {type: String, select: true, unique: true, index: true, required: true, dropDups: true},
      'gcmID' : {type: String, unique: true, required: true},
      'phone': {type: String},
      'loc': { type: [Number], index: '2dsphere'}
    });
  function _init(h,n) {
    h = h || dbHost;
    n = n || dbName;
    var d = Q.defer();
    if (bInit) {
      d.resolve();
      return d.promise;
    }
    var str = 'mongodb://'+ h +'/'+ n;
    //Create connection to DB server
    mongoose.connect(str);
    bInit = true;
    db = mongoose.connection;
    db.on('error', function () {
      d.reject('DB connection failed');
    });
    db.once('open', function cb(){
      userSchema.plugin(createdModifiedPlugin, {index: true});
      userSchema.index({'loc': '2dsphere'});
      model = db.model('user', userSchema);
      d.resolve();
    });
    return d.promise;
  }
  
  function _list(srch, lat, lon, since) {
    var bNear = (srch === 'nearby' && lat !== 0 && lon !== 0 ),
      d = Q.defer(), d2;
    if (bNear) {
      //Find user in given 10KM radius
      d2 = model.findQ({
        loc: {
          $near : { $geometry: {type: "Point", coordinates: [lon, lat] },
            $maxDistance : 10000
          }
        }
      });
    } else {
      d2 = model.findQ();
    }
    d2.then(function(doc){
      //console.log(JSON.stringify(doc));
      //map and extract only necessary fields
      var u = _(doc)
        .filter(function(v) {
            var lat = 0, lon = 0; if(v.loc) { lon = v.loc[0]; lat = v.loc[1];} return lat != 0 && lon != 0; 
        }).map(function (v) {
           return {'name': v.name, 'email': v.email, 'loc': v.loc, 'lon': v.loc ? v.loc[0] : "0", 'lat': v.loc ? v.loc[1] : "0"}; 
        }).value();
      d.resolve(u);
    }, function (e) {
      console.log('On Error ' + e);
      d.reject(e);
    });
    return d.promise; 
  }
  function _register(n,e,p,g) {
    console.log('on register');
    var d = Q.defer(), d2, bFailed = false, msg = '';
    if (n === '') {
      bFailed = true;
      msg = 'User name is mandatory';
    }
 
    e = e || _.uniqueId('fake_email_');
    p = p || _.uniqueId('fake_phone_');
    g = g || _.uniqueId('fake_gcm_');
    if (e.length === 0) {
      msg = "Please send valid email address!";
      bFailed = true;
    } else if (p.length === 0) {
      bFailed = true;
      msg = 'Give valid phone number';
    } else if(g.length === 0 ) {
      bFailed = true;
      msg = "GCM ID is missing"
    }
    
    if(bFailed) {
      msg = msg || 'Invalid params!';
      d.reject(msg);
    }
    //Find if the user is available
    //Search by name / email address
    
    var qu = model.where({name: n}).or({email: e}).findOneQ().then(function(doc) {
    
      if(!doc) {
        //let's insert the new user
        var user = new model();
        user.name = n;
        user.email = e;
        user.phone = p;
        user.gcmID = g;
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
  
  function _update(n, e, lat, lon) {
    console.log('on update');
    var msg = "", bFailed = false;
    var d = Q.defer();
    if(n.length === 0 ) {
      msg = "Username is must!";
      bFailed = true;
    } /*else if (e.length === 0) {
      msg = "Please send valid email address!";
      bFailed = true;
    } */else if (lat === 0 || lon === 0) {
      bFailed = true;
    }
    if(bFailed) {
      msg = msg || 'Invalid params!';
      d.reject(msg);
    }
    
    //only if user is in DB, update it
    model.where({name: n}).findOneQ().then(function(doc){
      if(doc) {
        //update to DB
        model.findOneAndUpdateQ({name: n}, {'loc': [lon, lat]}, {new: true}).then(function (doc2) {  
          d.resolve('Updated');
        }, function(e) {
          d.reject('Failed to update!');
        });
      } else {
        d.reject('USER_NOT_FOUND');
      }
      
    }, function() {
      d.reject('Unable to update doc');
    });

    return d.promise;
  }
  return {
    init: _init,
    list: _list,
    register: _register,
    update: _update
  };
}

module.exports = DBWrapper;