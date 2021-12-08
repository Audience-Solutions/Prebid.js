/**
 * This module adds JustId to the User ID module
 * The {@link module:modules/userId} module is required
 * @module modules/justIdSystem
 * @requires module:modules/userId
 */

import * as utils from '../src/utils.js'
import {ajax} from '../src/ajax.js';
import {submodule} from '../src/hook.js'
import { getStorageManager } from '../src/storageManager.js';
import { getRefererInfo } from '../src/refererDetection.js';
import { getGlobal } from '../src/prebidGlobal.js';

const MODULE_NAME = 'justId';
const LOG_PREFIX = 'User ID - JustId submodule: ';
const GVLID = 160;

const DOMAIN_ID_SERVER = 'id.nsaudience.pl';
const UID_COOKIE_SUFFIX = 'uid';
const UT_COOKIE_SUFFIX = 'ut';
const DAY_IN_SECONDS = 24 * 60 * 60;
const YEAR_IN_SECONDS = 365 * DAY_IN_SECONDS;
const DEBUG_JT_UID_PARAM = '__jtUid';

const storage = getStorageManager(GVLID, MODULE_NAME);
const pbjs = getGlobal();

/** @type {Submodule} */
export const justIdSubmodule = {
  /**
   * used to link submodule with config
   * @type {string}
   */
  name: MODULE_NAME,
  /**
   * required for the gdpr enforcement module
   */
  gvlid: GVLID,

  /**
   * decode the stored id value for passing to bid requests
   * @function
   * @param {{TDID:string}} value
   * @returns {{tdid:Object}}
   */
  decode(value) {
    utils.logInfo(LOG_PREFIX, 'decode', value);
    var debugUid = getDebugJustId();
    if(debugUid) {
      utils.logInfo(LOG_PREFIX, 'decode - debug justId', debugUid);
    }
    var justId = debugUid || value && value.uid;
    return justId && {justId: justId};
  },
  /**
   * performs action to obtain id and return a value in the callback's response argument
   * @function
   * @param {SubmoduleConfig} [config]
   * @returns {IdResponse|undefined}
   */
  getId(config, consentData, cacheIdObj) {
    utils.logInfo(LOG_PREFIX, 'getId', config, consentData, cacheIdObj);

    return {
      callback: function(cbFun) {
        try {
          new UidFetcher(cbFun, config, consentData).fetchUid();
        } catch (e) {
          utils.logError(LOG_PREFIX, 'Error during fetching...', e);
        }
      }
    };
  }
};

var UidFetcher = function(cbFun, config, consentData) {
  const idServerDomain = param(config).idServerDomain || DOMAIN_ID_SERVER;
  const idServcerUrl = `https://${idServerDomain}/getId`;
  const atmVarName = param(config).atmVarName || '__atm';
  const cookieTtlSeconds = param(config).cookieTtlSeconds || 2 * YEAR_IN_SECONDS;
  const cookieRefreshSeconds = param(config).cookieRefreshSeconds || DAY_IN_SECONDS;
  const cookiePrefix = param(config).cookiePrefix || '__jt';
  const uidCookieName = cookiePrefix + UID_COOKIE_SUFFIX;
  const utCookieName = cookiePrefix + UT_COOKIE_SUFFIX;
  const tcString = eoin(consentData).consentString;
  const prevStoredId = storage.getCookie(uidCookieName);
  const uidTime = storage.getCookie(utCookieName);
  const now = new Date().getTime();

  this.fetchUid = function() {
    utils.logInfo(LOG_PREFIX, 'fetching uid...');

    atmGetUid().then(atmGetUidSupported => {
      if(atmGetUidSupported) {
        return;
      }
      utils.logInfo(LOG_PREFIX, 'ATM not found!');
      if (prevStoredId && now < uidTime + cookieRefreshSeconds * 1000) {
        utils.logInfo(LOG_PREFIX, 'returning cookie stored UID', prevStoredId);
        returnUid(prevStoredId);
      } else {
        setTimeout(() => {
          ajax(idServcerUrl, idServerCallback(), JSON.stringify(prepareIdServerRequest()), { method: 'POST', withCredentials: true });
        }, 1);
      }
    });
  }

  function atmGetUid() {
    var atm = window[atmVarName];
    var atmExist = typeof atm === 'function';
    if (!atmExist) {
      utils.logInfo(LOG_PREFIX, 'ATM function not found!', atmVarName, atm);
      return Promise.resolve(false);
    }

    return promiseWithTimeout(res => atm('getReadyState', res), 3000)
      .then(() => {
        return Promise.resolve(atm('getVersion')) // string || Promise<string>
          .then(atmVersion => {
            utils.logInfo(LOG_PREFIX, 'ATM Version', atmVersion);
            var isGetUidSupported = utils.isStr(atmVersion); // getVersion command was introduced in same ATM version as getUid command

            if (isGetUidSupported) {
              atm('getUid', returnUid);
            }
            return isGetUidSupported;
          });
      }, err => {
        utils.logInfo(LOG_PREFIX, 'getReadyState timeout', atmVarName, err);
        return false;
      });
  }

  function prepareIdServerRequest() {
    return {
      prevStoredId: prevStoredId,
      tcString: tcString,
      url: getPageUrl(),
      referrer: getReferrer(),
      topLevelAccess: getRefererInfo().reachedTop,
      userAgent: navigator.userAgent,
      clientLib: 'pbjs',
      pbjs: {
        version: '$prebid.version$',
        uids: getUserIds()
      }
    };
  }

  function idServerCallback() {
    return {
      success: response => {
        utils.logInfo(LOG_PREFIX, 'getId response: ', response);

        try {
          if (utils.isEmpty(response)) {
            utils.logError(LOG_PREFIX, 'empty getId response');
            return;
          }
          var responseObj = JSON.parse(response);
          returnUid(responseObj.uid);
          setUidCookie(responseObj.uid, responseObj.tld);
        } catch (e) {
          utils.logError(LOG_PREFIX, 'error on parsing getId response', e);
        }
      },
      error: error => {
        utils.logError(LOG_PREFIX, 'error during getId request', error);
        cbFun();
      }
    }
  }

  function setUidCookie(uid, tld) {
    var d = new Date();
    d.setTime(d.getTime() + cookieTtlSeconds * 1000);
    var expires = d.toUTCString();
    storage.setCookie(uidCookieName, uid, expires, null, tld);
    storage.setCookie(utCookieName, now, expires, null, tld);
  }

  function returnUid(uid) {
    if (!utils.isFn(cbFun)) {
      utils.logError(LOG_PREFIX, 'cbFun is not function!');
      return;
    }
    if (utils.isEmptyStr(uid)) {
      utils.logError(LOG_PREFIX, 'empty uid!');
      return;
    }
    cbFun({uid: uid});
  }
}

function eoin(o) {
  return o || {};
}

function param(c) {
  return eoin(c.params);
}

function getDebugJustId() {
  var pageUrl = getPageUrl();
  if(pageUrl) {
    return new URL(pageUrl).searchParams.get(DEBUG_JT_UID_PARAM);
  }
}

function getPageUrl() {
  try {
    return window.top.location.href;
  } catch (e) {
    if (window.parent == window.top) {
      return document.referrer;
    }
  }
}

function getReferrer() {
  try {
    return window.top.document.referrer;
  } catch (e) { }
}

function getUserIds() {
  if (utils.isFn(pbjs.getUserIds)) {
    return pbjs.getUserIds();
  }
}

function promiseWithTimeout(promiseFun, time) {
  return new Promise((res, rej) => {
    var tm = setTimeout(() => {
      rej(new Error("timeout"));
    }, time);
    
    function callAndClearTimeout(fn) {
      return arg => {
        clearTimeout(tm);
        return fn(arg);
      }
    }
    promiseFun(callAndClearTimeout(res), callAndClearTimeout(rej));
  });
}

submodule('userId', justIdSubmodule);
