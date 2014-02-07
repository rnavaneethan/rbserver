var mongoose= require('mongoose-q')(),
  Q = require('q'),
  _ = require('lodash'),
  defGCM = 'APA91bG21dzWPgpabcgfXm_zmxx1ouYjM2PJol6JQd9uD5idpijorwYUBc-Kit69ScC3KGaih8Oow_M7QidUG7aPdq_fnrTfGOagB9AOkJ1a3nmwcpX9DrcjrGbrOElhqj0s1YNtfWWxoOfnpx5DwpLteCm8uz3g1g';

function DBWrapper() {
  var dbHost = 'localhost', 
    dbName = 'rb',
    bInit = false,
    db = null, model = null, requestModel = null,
    userSchema = new mongoose.Schema({
      'name' : {type: String, select: true, unique: true, dropDups: true, index: true, required: true},
      'email' : {type: String, select: true, unique: true, index: true, required: true, dropDups: true},
      'gcmID' : {type: String},
      'phone': {type: String},
      'loc': { type: [Number], index: '2dsphere'},
      'created':{type: Date},
      'modified':{type: Date, index: true}
    }),
    requestSchema = new mongoose.Schema({
      'requser': {type: String, select: true, unique: true, index:true, required: true, dropDups: true},
      'accuser': {type: String, required: false},
      'fromloc': {type: [Number], index: '2dsphere', required: true},
      'toloc': {type: [Number], index: '2dsphere', required: true},
      'created':{type: Date},
      'modified':{type: Date, index: true}
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
      userSchema.index({'loc': '2dsphere'});
      model = mongoose.model('user', userSchema);
      
      requestSchema.index({'fromloc': '2dsphere', 'toloc':'2dsphere'});
      requestModel = mongoose.model('request', requestSchema);
      d.resolve();
    });
    return d.promise;
  }
  
  function _list(srch, lat, lon, since) {
    var bNear = (srch === 'nearby' && lat !== 0 && lon !== 0 ),
      d = Q.defer(), d2, findObj = {};
    if (bNear) {
      //Find user in given 10KM radius
      _.extend(findObj, {
        loc: {
          $near : { $geometry: {type: "Point", coordinates: [lon, lat] },
            $maxDistance : 10000
          }
        }
      });
    }
    
    //what about timestamp check
    since = (_.isNumber(since) && !isNaN(since) ) ? since : 0;
    
    if(since) {
      _.extend(findObj, {'modified': {$gte : new Date(since)}});
    }
    model.findQ(findObj).then(function(doc){
      //console.log(JSON.stringify(doc));
      //map and extract only necessary fields
      var u = _(doc)
        .filter(function(v) {
            var lat = 0, lon = 0; if(v.loc) { lon = v.loc[0]; lat = v.loc[1];} return lat != 0 && lon != 0; 
        }).map(function (v) {
           return {'name': v.name, 'email': v.email, 'phone' : v.phone, 'loc': v.loc, 'lon': v.loc ? v.loc[0] : "0", 'lat': v.loc ? v.loc[1] : "0", 'modified': new Date(v.modified).getTime()}; 
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
    g = g || 'fake_gcm_';
    //g = g || defGCM;
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
        user.created = user.modified = new Date();
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
  
  function _update(n, e, lat, lon, gcm) {
    var msg = "", bFailed = false;
    var d = Q.defer();
    if(n.length === 0 ) {
      msg = "Username is must!";
      bFailed = true;
    } /*else if (e.length === 0) {
      msg = "Please send valid email address!";
      bFailed = true;
    } */else if ( (lat === 0 || lon === 0) && !gcm.length) {
      bFailed = true;
    }
    if(bFailed) {
      msg = msg || 'Invalid params!';
      d.reject(msg);
    }
    
    //only if user is in DB, update it
    model.where({name: n}).findOneQ().then(function(doc){
      if(doc) {
        var updateObj = {};
        if (lat !== 0 && lon !== 0) {
          _.extend(updateObj, {'loc': [lon, lat]});
        }
        if(gcm.length) {
          _.extend(updateObj, {gcmID: gcm});
        }
        if (!_.isEmpty(updateObj)) {
          _.extend(updateObj, {modified: new Date()});

          //update to DB
          model.findOneAndUpdateQ({name: n}, updateObj, {new: true}).then(function (doc2) {  
            d.resolve('Updated ' + n);
          }, function(e) {
            d.reject('Failed to update!' + n);
          });
        }
      } else {
        d.reject('Update: USER_NOT_FOUND ' + n);
      }
      
    }, function() {
      d.reject('Unable to update ' + n);
    });

    return d.promise;
  }
  function _query(user) {
    var d = Q.defer(),userInfo = {};
    if(!user.length) {
      d.reject(userInfo);
    }
    //Let's query DB now
    model.findOneQ({name: user}).then(function (doc) {
      
      if(doc) {
        _.extend(userInfo, {name: doc.name, email: doc.email, phone: doc.phone, gcmID: (doc.gcmID || ''), loc: doc.loc});
        d.resolve(userInfo);

      }else {
        d.reject(userInfo);        
      }
    },function (e) {
      d.reject(userInfo);
    });
    return d.promise;
  }
  
  function _getRequest(user, id) {
    var user = user || '', id = id || '', reqObj = {}, d = Q.defer(), reqInfo = {};
    if(!user.length && !id.length) {
      d.reject(reqInfo);
    }
    user.length && _.extend(reqObj, {'requser': user});
    id.length && _.extend(reqObj, {'_id': id});
    //Build query and query the table
    requestModel.findOneQ(reqObj).then(function(doc) {
      if(doc) {
        _.extend(reqInfo, {
          id: doc._id,
          requser: doc.requser,
          accuser: (doc.accuser || ''),
          fromloc: doc.fromloc,
          toloc: doc.toloc
        });
      }
    }).finally(function () {
      d.resolve(reqInfo);
    });
    return d.promise;
  }
  
  function _addRequest(user, from, to) {
    var d = Q.defer(), reqInfo = {};
    
    //do input validation
    if(!user.length || !_.isArray(from) || !_.reduce([from, to], function (memo, v) {
      if(!memo) {
        //skip further check
        return memo;
      }
      return _.isArray(v) && v.length === 2 && _.isNumber(v[0]) && !_.isNaN(v[0]) && _.isNumber(v[1]) && !_.isNaN(v[1]);
    }, true)) {
      d.reject(reqInfo);
    }
    //Let's remove existing request from same user and add new
    //Add a query which will insert/update the existing one based on user
    Q.allSettled([requestModel.removeQ({'requser':user}),_getRequest(user)]).spread(function(olddoc, info) {
      if (info.state === 'fulfilled' && _.isEmpty(info.data)) {
        //There are no previous request for the user
        //Let's insert a new one
        var req = new requestModel();
        req.requser = user;
        req.fromloc = from;
        req.toloc = to;
        req.created = req.modified = new Date();
        req.save(function(e,p) {
          if (e) {
            console.log(e);
            d.reject(reqInfo);
          }
          //update response object
          _.extend(reqInfo, {id: p._id, user: p.requser, from: p.fromloc, to: p.toloc});
          d.resolve(reqInfo);
        });
      } else {
        //Update the existing request
        requestModel.findOneAndUpdateQ({requser: user},{fromloc: from, toloc: to, accuser: '', modified: new Date()},{new: true}).then(function (doc) {
          if (doc) {
            _.extend(reqInfo, {id: doc._id, user: doc.requser, from: doc.fromloc, to: doc.toloc});
          }
          d.resolve(reqInfo);
        }, function (e) {
          d.reject(reqInfo);
        });
      }
    }, function () {
      d.reject(reqInfo);
    });
    return d.promise;
  }
  function _acceptRequest(accuser,id) {
    var d = Q.defer(), result = {};
    //input validation
    if( !accuser.length || !id.length ) {
      d.reject('Invalid params!');
    }
    
    //the user going to accept is valid user? & we have valid request ID
    Q.all([_query(accuser), _getRequest(null, id)]).spread(function(accusr, doc){
      //requestor is valid user && the document object exists
      _.isEmpty(accuser) && d.reject('acceptrequest: You are not a valid user ' + accuser);
      _.isEmpty(doc) && d.reject('acceptrequest: Invalid/expired request ID ' + id);
      (doc.requser.length && accuser === doc.requser ) && d.reject("acceptrequest: User can't accept his request " + accuser);
      
      //get details about req user & update the record with accepted user and serve response
      Q.all([_query(doc.requser), requestModel.findOneAndUpdateQ({"_id" : id}, {'accuser': accuser, modified: new Date()}, {new: true})]).spread(function (requsr, doc2) {
        _.extend(result, {
          id: doc2._id,
          user: doc2.requser,
          accuser: doc2.accuser,
          from: doc2.fromloc,
          to: doc2.toloc,
          reqgcmID: requsr.gcmID,
          accgcmID: accusr.gcmID
        });
        d.resolve(result);
      },function () {
        d.reject('acceptrequest: Unable to update'  + id + ' ' + accuser);
      });
    }, function(){
      d.reject('acceptrequest: Unable to find request record ' + id + ' ' + accuser);
    });
    return d.promise;
  }
  function _getValidGCMUsers() {
    //returns valid users with GCMId
    var d = Q.defer(),result = {};
    model.where({gcmID: {$not: /^fake_gcm_/}},'name gcmID').findQ().then(function (doc){
      if(doc) {
        result = _.reduce(doc, function(m, v) {m[v.name] = v.gcmID; return m;},result);
      }
      d.resolve(result);
  	}, function () {
  	  console.log('Unable to get users by gcmID','name gcmID');
  	  d.reject(result);
	  });
    return d.promise;
  }
  return {
    init: _init,
    list: _list,
    register: _register,
    update: _update,
    query: _query,
    getValidGCMUsers: _getValidGCMUsers, 
    getRequest: _getRequest,
    addRequest: _addRequest,
    acceptRequest: _acceptRequest
  };
}

module.exports = DBWrapper;

