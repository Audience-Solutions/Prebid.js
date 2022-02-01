/**
 * This module adds JustId to the User ID module
 * The {@link module:modules/userId} module is required
 * @module modules/justIdSystem
 * @requires module:modules/userId
 */

import * as utils from '../src/utils.js'
import {submodule} from '../src/hook.js'

const MODULE_NAME = 'justId';
const LOG_PREFIX = 'User ID - JustId submodule: ';
const GVLID = 160;
const DEFAULT_URL = 'https://id.nsaudience.pl/getId.js';
const DEFAULT_PARTNER = 'pbjs-just-id-module';
const DEFAULT_MODE = 'ATM';

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

          var uidProvider = configWrapper.isAdvencedMode()
            ? new AdvencedUidProvider(configWrapper, consentData, cacheIdObj)
            : new AtmUidProvider(configWrapper);

          uidProvider.getUid(justId => {
            if (utils.isEmptyStr(justId)) {
              utils.logError(LOG_PREFIX, 'empty uid!');
              cbFun();
              return;
            }
            cbFun({uid: justId});
          }, err => {
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
  this.getConfig = function() {
    return config;
  }

  this.getMode = function() {
    return params().mode || DEFAULT_MODE;
  }

  this.getPartner = function() {
    return params().partner || DEFAULT_PARTNER;
  }

  this.isAdvencedMode = function() {
    return this.getMode() === 'ADVENCED';
  }

  this.getAtmVarName = function() {
    return params().atmVarName || '__atm';
  }

  this.getUrl = function() {
    const u = params().url || DEFAULT_URL;
    const url = new URL(u);
    url.searchParams.append('sourceId', this.getPartner());
    return url.toString();
  }

  function params() {
    return config.params || {};
  }
}

const AdvencedUidProvider = function(configWrapper, consentData, cacheIdObj) {
  const url = configWrapper.getUrl();

  this.getUid = function(idCallback, errCallback) {
    const scriptTag = jtUtils.createScriptTag(url);

    scriptTag.addEventListener('justIdReady', event => {
      utils.logInfo(LOG_PREFIX, 'received justId', event);
      idCallback(event.detail && event.detail.justId);
    });

    scriptTag.onload = () => {
      utils.logInfo(LOG_PREFIX, 'script loaded', url);
      scriptTag.dispatchEvent(new CustomEvent('prebidGetId', { detail: { config: configWrapper.getConfig(), consentData: consentData, cacheIdObj: cacheIdObj } }));
    };

    scriptTag.onerror = errCallback;

    document.head.appendChild(scriptTag);
  }
}

const AtmUidProvider = function(configWrapper) {
  const atmVarName = configWrapper.getAtmVarName();

  this.getUid = function(idCallback, errCallback) {
    var atm = jtUtils.getAtm(atmVarName);

    if (typeof atm !== 'function') {
      utils.logInfo(LOG_PREFIX, 'ATM function not found!', atmVarName, atm);
      errCallback('atm function not found');
      return
    }
    return promiseWithTimeout(res => atm('getReadyState', res), 5000) // timeout has objectively large value, because ATM (JustTag library that may already exists on publisher page) are typically stubbed and deferred
      .then(() => atm('getVersion')) // atm('getVersion') returns string || Promise<string>
      .then(atmVersion => {
        utils.logInfo(LOG_PREFIX, 'ATM Version', atmVersion);
        if (utils.isStr(atmVersion)) { // getVersion command was introduced in same ATM version as getUid command
          atm('getUid', idCallback);
        } else {
          errCallback('ATM getUid not supported');
        }
      });
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

export const jtUtils = {
  createScriptTag(url) {
    const scriptTag = document.createElement('script');
    scriptTag.async = true;
    scriptTag.src = url;
    return scriptTag;
  },
  getAtm(atmVarName) {
    return window[atmVarName];
  }
}

submodule('userId', justIdSubmodule);
