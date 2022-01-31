import { justIdSubmodule, ConfigWrapper, ExternalUidProvider, jtUtils } from 'modules/justIdSystem.js';

const DEFAULT_DOMAIN = 'id.nsaudience.pl';
const DEFAULT_PARTNER = 'pbjs-just-id-module';

describe('JustIdSystem', function () {
  describe('getUrl', function() {
    it('defaultUrl', function() {
      expect(new ConfigWrapper({}).getUrl().toString()).to.eq(expectedUrl(DEFAULT_DOMAIN, true, DEFAULT_PARTNER));
    })

    it('customPartner', function() {
      const partner = 'abc';
      expect(new ConfigWrapper({params: {partner: partner}}).getUrl().toString()).to.eq(expectedUrl(DEFAULT_DOMAIN, true, partner));
    })

    it('customDomain', function() {
      const domain = 'example.com';
      expect(new ConfigWrapper({params: {domain: domain}}).getUrl().toString()).to.eq(expectedUrl(domain, true, DEFAULT_PARTNER));
    })

    it('customPartnerAndDomain', function() {
      const partner = 'abc';
      const domain = 'example.com';
      expect(new ConfigWrapper({params: {partner: partner, domain: domain}}).getUrl().toString()).to.eq(expectedUrl(domain, true, partner));
    })

    it('defaultUrlIdServer', function() {
      expect(new ConfigWrapper({ params: { mode:'INTERNAL' } }).getUrl().toString()).to.eq(expectedUrl(DEFAULT_DOMAIN, false, DEFAULT_PARTNER));
    })

    it('customPartnerIdServer', function() {
      const partner = 'abc';
      expect(new ConfigWrapper({params: { partner: partner, mode:'INTERNAL' }}).getUrl().toString()).to.eq(expectedUrl(DEFAULT_DOMAIN, false, partner));
    })

    it('customDomainIdServer', function() {
      const domain = 'example.com';
      expect(new ConfigWrapper({params: { domain: domain, mode:'INTERNAL' }}).getUrl().toString()).to.eq(expectedUrl(domain, false, DEFAULT_PARTNER));
    })

    it('customPartnerAndDomainIdServer', function() {
      const partner = 'abc';
      const domain = 'example.com';
      expect(new ConfigWrapper({params: {partner: partner, domain: domain, mode:'INTERNAL' }}).getUrl().toString()).to.eq(expectedUrl(domain, false, partner));
    })
  });

  describe('decode', function() {
    it('decode justId', function() {
      const justId = 'aaa';
      expect(justIdSubmodule.decode({uid: justId})).to.deep.eq({justId: justId});
    })
  });

  describe('getId', function() {
    const scriptTag = document.createElement('script');

    const onPrebidGetId = sinon.stub().callsFake(event => {
      var cacheIdObj = event.detail && event.detail.cacheIdObj;
      var justId = (cacheIdObj && cacheIdObj.uid && cacheIdObj.uid + '-x') || 'user123';
      scriptTag.dispatchEvent(new CustomEvent('justIdReady', { detail: { justId: justId } }));
    });

    scriptTag.addEventListener('prebidGetId', onPrebidGetId)

    sinon.stub(jtUtils, 'createScriptTag').returns(scriptTag);

    it('without cachedIdObj', function() {
      const callbackSpy = sinon.spy();
      new ExternalUidProvider(new ConfigWrapper({})).getUid(callbackSpy);

      scriptTag.onload();

      expect(callbackSpy.lastCall.lastArg).to.equal('user123');
    });
/*
    it('with cachedIdObj', function() {
      const callbackSpy = sinon.spy();

      justIdSubmodule.getId(undefined, undefined, { uid: 'userABC' }).callback(callbackSpy);

      scriptTag.onload();

      expect(callbackSpy.lastCall.lastArg.uid).to.equal('userABC-x');
    });

    it('check getId arguments are passed to prebidGetId event', function() {
      const callbackSpy = sinon.spy();

      const a = { x: 'x' }
      const b = { y: 'y' }
      const c = { z: 'z' }

      justIdSubmodule.getId(a, b, c).callback(callbackSpy);

      scriptTag.onload();

      expect(onPrebidGetId.lastCall.lastArg.detail).to.deep.eq({ config: a, consentData: b, cacheIdObj: c });
    });
*/
  });
});

function expectedUrl(domain, isExternalMode, srcId) {
  return `https://${domain}/getId${isExternalMode ? '.js?sourceId=' + srcId : ''}`
}
