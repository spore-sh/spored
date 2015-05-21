var config = require('./config'),
    debug = require('./debug'),
    request = require('request'),
    parseBody = require('qs').parse,
    retry = require('./retry').retry;

exports.passThrough = passThrough;
function passThrough (req, res, next) {
  sendRequest(req, function (err, response, body) {
    if(err) return next(err);

    sendResponse(res, response, body);
  });
}

exports.sendResponse = sendResponse;
function sendResponse(res, response, body) {
  res.set(response.headers);

  // Add our proxy info
  res.append('Via', config.proxyName);

  res.status(response.statusCode).send(body);
}

exports.sendRequest = sendRequest;
function sendRequest(req, callback) {
  retry.now(function (err) {
    if(err) return callback(err);

    sendRequestImmediate(req, callback);
  });
}

exports.sendRequestImmediate = sendRequestImmediate;
function sendRequestImmediate(req, callback) {
  var headers = req.headers;

  // Add our proxy info
  if(!headers.via) {
    headers.via = config.proxyName;
  } else {
    headers.via += ", " + config.proxyName;
  }

  request({
    url: fullUrl(req.originalUrl),
    method: req.method,
    body: Buffer.isBuffer(req.body) ? req.body : undefined,
    encoding: null,
    headers: headers
  }, function (err, response, body) {
    if(err) return callback(err);

    callback(null, response, body);
  });
}

// check whether a request should be cached as a GET request,
// and get the contents of a fake GET request
exports.postCache = postCache;
function postCache(req) {
  var body,
      url,
      type,
      json = {};

  debug("Checking " + req.method + " " + req.originalUrl + " for cacheability");

  if(req.method.toUpperCase() !== 'POST') {
    debug("not a POST request, so not a create");
    return false;
  }

  if(!Buffer.isBuffer(req.body)) {
    debug("Body isn't a buffer, assume it's empty");
    return false;
  }

  try {
    body = parseBody(req.body.toString());
  } catch(e) {
    debug("Body isn't a valid url encoded string");
    return false;
  }

  if(!body.id) {
    debug("No body id, so no way to build a url");
    return false;
  }

  // e.g. /apps -> 'app'
  type = singularize(req.originalUrl.split('/').pop());
  url = req.originalUrl + '/' + body.id;

  debug("Setting body as a JSON child of " + type);

  json[type] = body;

  return {
    method: 'GET',
    url: url,
    body: new Buffer(JSON.stringify(json)),
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Connection: 'keep-alive'
    }
  };
}

exports.noCache = noCache;
function noCache(headers) {
  return headerHasValue(headers, 'pragma', 'no-cache') || headerHasValue(headers, 'cache-control', 'no-cache');
}

exports.noBuffer = noBuffer;
function noBuffer(headers) {
  return !headerHasValue(headers, 'prefer', 'respond-async');
}

exports.maxAge = maxAge;
function maxAge(headers) {
  if(!headers) {
    debug("No headers given, returning maximum maxAge of 1 year");
    return 31536000;
  }

  if(headers['cache-control']) {

    var cacheControls = headerValues(headers, 'cache-control');

    for(var i=0; i<cacheControls.length; i++) {
      if(cacheControls[i] && cacheControls[i].split('=')[0] === 'max-age' && cacheControls[i].split('=')[1]) {
        debug("cache-control max-age directive found");
        return parseInt(cacheControls[i].split('=')[1], 10);
      }
    }
  }

  if(headers.expires) {
    var expires = new Date(headers.expires),
        now = new Date();

    debug("expires directive found");
    return expires.getTime() - now.getTime();
  }

  debug("No maxAge directive found in headers, setting maxAge to zero");
  return 0;
}

function headerHasValue(headers, name, value) {
  var values = headerValues(headers, name);

  for(var i=0; i<values.length; i++) {
    if(values[i] === value) {
      return true;
    }
  }
  return false;
}

function headerValues(headers, name) {
  return (headers[name] || "").split(',').map(function (val) {
    return val.trim();
  }).filter(function (val) {
    return !!val;
  });
}

function fullUrl(url) {
  return config.host + url;
}

function singularize(word) {
  if(word.slice(-1).toLowerCase() === 's') {
    return word.slice(0, -1);
  }
  return word;
}
