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

const DEFAULT_DOMAIN = 'id.nsaudience.pl';
const DEFAULT_PARTNER = 'pbjs-just-id-module';
const DEFAULT_MODE = 'EXTERNAL';

const UID_COOKIE_SUFFIX = 'uid';
const UT_COOKIE_SUFFIX = 'ut';
const DAY_IN_SECONDS = 24 * 60 * 60;
const YEAR_IN_SECONDS = 365 * DAY_IN_SECONDS;

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
   * @param {{uid:string}} value
   * @returns {{justId:string}}
   */
  decode(value) {
    utils.logInfo(LOG_PREFIX, 'decode', value);
    const justId = value && value.uid;
    return justId && {justId: justId};
  },

  /**
   * performs action to obtain id and return a value in the callback's response argument
   * @function
   * @param {SubmoduleConfig} config
   * @param {ConsentData} consentData
   * @param {(Object|undefined)} cacheIdObj
   * @returns {IdResponse|undefined}
   */
  getId(config, consentData, cacheIdObj) {
    utils.logInfo(LOG_PREFIX, 'getId', config, consentData, cacheIdObj);

    return {
      callback: function(cbFun) {
        try {
          utils.logInfo(LOG_PREFIX, 'fetching uid...');

          var configWrapper = new ConfigWrapper(config);
          var atmUidProvider = new AtmUidProvider(configWrapper);

          atmUidProvider.getUid()
            .catch(cause => {
              utils.logInfo(LOG_PREFIX, 'ATM not return uid', cause);

              var uidProvider = configWrapper.isExternalMode()
                ? new ExternalUidProvider(configWrapper, consentData, cacheIdObj)
                : new InternalUidProvider(configWrapper, consentData);

              return uidProvider.getUid();
            })
            .then(uid => {
              if (utils.isEmptyStr(uid)) {
                utils.logError(LOG_PREFIX, 'empty uid!');
                cbFun();
                return;
              }
              cbFun({uid: uid});
            })
            .catch(err => {
              utils.logError(LOG_PREFIX, 'error during fetching', err);
              cbFun();
            });
        } catch (e) {
          utils.logError(LOG_PREFIX, 'Error during fetching...', e);
        }
      }
    };
  }
};

export const ConfigWrapper = function(config) {
  const cookiePrefix = params(config).cookiePrefix || '__jt';

  this.getConfig = function() {
    return config;
  }

  this.getUidCookieName = function() {
    return cookiePrefix + UID_COOKIE_SUFFIX;
  }

  this.getUtCookieName = function() {
    return cookiePrefix + UT_COOKIE_SUFFIX;
  }

  this.getCookieTtlSeconds = function() {
    return params(config).cookieTtlSeconds || 2 * YEAR_IN_SECONDS;
  }

  this.getCookieRefreshSeconds = function() {
    return params(config).cookieRefreshSeconds || DAY_IN_SECONDS;
  }

  this.isExternalMode = function() {
    const mode = params(config).mode || DEFAULT_MODE;
    return mode === 'EXTERNAL';
  }

  this.getAtmVarName = function() {
    return params(config).atmVarName || '__atm';
  }

  this.getUrl = function() {
    const domain = params(config).domain || DEFAULT_DOMAIN;

    const url = new URL(`https://${domain}/getId`);
    if (this.isExternalMode()) {
      const partner = params(config).partner || DEFAULT_PARTNER;
      url.pathname += '.js';
      url.searchParams.append('sourceId', partner);
    }
    return url;
  }

  function params(c) {
    return eoin(c.params);
  }
}

var InternalUidProvider = function(configWrapper, consentData) {
  const uidCookieName = configWrapper.getUidCookieName();
  const utCookieName = configWrapper.getUtCookieName();
  const prevStoredId = storage.getCookie(uidCookieName);
  const uidTime = storage.getCookie(utCookieName);
  const now = new Date().getTime();

  this.getUid = function() {
    return new Promise((resolve, reject) => {
      if (prevStoredId && now < uidTime + configWrapper.getCookieRefreshSeconds() * 1000) {
        utils.logInfo(LOG_PREFIX, 'returning cookie stored UID', prevStoredId);
        resolve(prevStoredId);
      } else {
        setTimeout(() => {
          ajax(configWrapper.getUrl(), idServerCallback(resolve, reject), JSON.stringify(prepareIdServerRequest()), { method: 'POST', withCredentials: true });
        }, 1);
      }
    });
  }

  function prepareIdServerRequest() {
    const tcString = eoin(consentData).consentString;

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

  function idServerCallback(resolve, reject) {
    return {
      success: response => {
        utils.logInfo(LOG_PREFIX, 'getId response: ', response);
        try {
          if (utils.isEmpty(response)) {
            reject(new Error('empty getId response'));
            return;
          }
          var responseObj = JSON.parse(response);
          resolve(responseObj.uid);
          setUidCookie(responseObj.uid, responseObj.tld);
        } catch (e) {
          utils.logError(LOG_PREFIX, 'error on parsing getId response', e);
          reject(new Error('parsing error'));
        }
      },
      error: error => {
        utils.logError(LOG_PREFIX, 'error during getId request', error);
        reject(error);
      }
    }
  }

  function setUidCookie(uid, tld) {
    var d = new Date();
    d.setTime(d.getTime() + configWrapper.getCookieTtlSeconds() * 1000);
    var expires = d.toUTCString();
    storage.setCookie(uidCookieName, uid, expires, null, tld);
    storage.setCookie(utCookieName, now, expires, null, tld);
  }
}

export const ExternalUidProvider = function(configWrapper, consentData, cacheIdObj) {
  const url = configWrapper.getUrl();

  this.getUid = function() {
    return new Promise(resolve => {
      const scriptTag = jtUtils.createScriptTag(url);

      scriptTag.addEventListener('justIdReady', event => {
        utils.logInfo(LOG_PREFIX, 'received justId', event);
        resolve(event.detail && event.detail.justId);
      });

      scriptTag.onload = () => {
        utils.logInfo(LOG_PREFIX, 'script loaded', url);
        scriptTag.dispatchEvent(new CustomEvent('prebidGetId', { detail: { config: configWrapper.getConfig(), consentData: consentData, cacheIdObj: cacheIdObj } }));
      };

      document.head.appendChild(scriptTag);
    });
  }

}

export const jtUtils = {
  createScriptTag(url) {
    const scriptTag = document.createElement('script');
    scriptTag.async = true;
    scriptTag.src = url;
    return scriptTag;
  }
}

var AtmUidProvider = function(configWrapper) {
  const atmVarName = configWrapper.getAtmVarName();

  this.getUid = function() {
    var atm = window[atmVarName];

    if (typeof atm !== 'function') {
      utils.logInfo(LOG_PREFIX, 'ATM function not found!', atmVarName, atm);
      return Promise.reject(new Error('atm function not found'));
    }

    return promiseWithTimeout(res => atm('getReadyState', res), 5000) // timeout has objectively large value, because ATM (JustTag library that may already exists on publisher page) are typically stubbed and deferred
      .then(() => atm('getVersion')) // atm('getVersion') returns string || Promise<string>
      .then(atmVersion => {
        utils.logInfo(LOG_PREFIX, 'ATM Version', atmVersion);
        var isGetUidSupported = utils.isStr(atmVersion); // getVersion command was introduced in same ATM version as getUid command

        if (isGetUidSupported) {
          return atm('getUid');
        }
        throw new Error('ATM getUid not supported')
      });
  }
}

function eoin(o) {
  return o || {};
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
  return new Promise((resolve, reject) => {
    var tm = setTimeout(() => {
      reject(new Error('timeout'));
    }, time);

    function callAndClearTimeout(fn) {
      return arg => {
        clearTimeout(tm);
        return fn(arg);
      }
    }
    promiseFun(callAndClearTimeout(resolve), callAndClearTimeout(reject));
  });
}

submodule('userId', justIdSubmodule);
