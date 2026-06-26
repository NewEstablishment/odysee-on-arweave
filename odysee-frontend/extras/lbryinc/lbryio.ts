import * as ACTIONS from 'constants/action_types';
import Lbry from 'lbry';
// Use browser-native URLSearchParams instead of Node's querystring module
import analytics from 'analytics';
import { getAuthToken as getSavedAuthToken } from 'util/saved-passwords';
import {
  HYPERBEAM_DEVICE,
  hyperbeamDeviceBase,
  hyperbeamDevicePostParams64,
  hyperbeamDeviceUrl,
} from 'util/hyperbeamDevices';
import { legacyAuthIdentifyHeaders } from 'util/hyperbeamLegacyAuth';
import { isHyperbeamEnabled, shouldAllowOriginalNetworkFallback } from 'util/hyperbeamMode';
const Lbryio: {
  enabled: boolean;
  authenticationPromise: Promise<any> | null;
  exchangePromise: Promise<any> | null;
  exchangeLastFetched: number | null;
  CONNECTION_STRING: string;
  authToken: string | null;
  overrides: Record<string, any>;
  setLocalApi: (endpoint: string) => void;
  call: (resource: string, action: string, params?: any, method?: string, noAuth?: boolean) => Promise<any>;
  getAuthToken: () => Promise<string | null>;
  getCurrentUser: () => Promise<any>;
  authenticate: (domain?: string, language?: string) => Promise<any>;
  getStripeToken: () => string;
  getExchangeRates: () => Promise<any>;
  setOverride: (methodName: string, newMethod: (...args: any[]) => any) => void;
} = {
  enabled: true,
  authenticationPromise: null,
  exchangePromise: null,
  exchangeLastFetched: null,
  CONNECTION_STRING: 'https://api.lbry.com/',
} as any;
const EXCHANGE_RATE_TIMEOUT = 20 * 60 * 1000;
const INTERNAL_APIS_DOWN = 'internal_apis_down';

function hyperbeamNodeBase() {
  return hyperbeamDeviceBase(HYPERBEAM_DEVICE.internalApis);
}

function hyperbeamNodeConfigured() {
  return Boolean(hyperbeamNodeBase());
}

function base64Url(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unwrapJsonRpcResult(json) {
  if (json && json.error) {
    throw new Error(json.error.message || json.error);
  }

  return json && Object.prototype.hasOwnProperty.call(json, 'result') ? json.result : json;
}

function hyperbeamNodeFetchJson(key: string, params: any = {}, authToken: string | null = null) {
  const base = hyperbeamNodeBase();
  const params64 = base64Url(JSON.stringify(params || {}));
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (authToken) {
    headers['X-Lbry-Auth-Token'] = authToken;
  }

  return fetch(hyperbeamDeviceUrl(HYPERBEAM_DEVICE.internalApis, key, { params64 }), {
    method: 'GET',
    headers,
  }).then(async (response) => {
    const json = await response.json().catch(() => null);

    if (!response.ok) {
      const error = new Error(json?.error || `HyperBEAM device ${key} failed with ${response.status}`);
      (error as any).response = response;
      (error as any).status = response.status;
      (error as any).body = json;
      throw error;
    }

    return unwrapJsonRpcResult(json);
  });
}

function hyperbeamDeviceFetchJson(device: string, key: string, params: any = {}, headers: Record<string, string> = {}) {
  const request = hyperbeamDevicePostParams64(device, key, params, headers);
  if (!request) return null;

  return request.then(async (response) => {
    const json = await response.json().catch(() => null);

    if (!response.ok) {
      const error = new Error(json?.error || `HyperBEAM device ${key} failed with ${response.status}`);
      (error as any).response = response;
      (error as any).status = response.status;
      (error as any).body = json;
      throw error;
    }

    return unwrapJsonRpcResult(json);
  });
}

function hyperbeamLegacyAuthUser(authToken: string) {
  const base = hyperbeamDeviceBase(HYPERBEAM_DEVICE.legacyAuth);
  if (!base) return null;

  return fetch(`${base}/identify`, {
    method: 'GET',
    headers: legacyAuthIdentifyHeaders(authToken),
  }).then(async (response) => {
    const json = await response.json().catch(() => null);

    if (!response.ok) {
      const error = new Error(json?.error || `legacy-auth/identify failed with ${response.status}`);
      (error as any).response = response;
      (error as any).status = response.status;
      (error as any).body = json;
      throw error;
    }

    return hyperbeamLegacyIdentityUser(unwrapJsonRpcResult(json));
  });
}

function hyperbeamLegacyIdentityUser(identity: any) {
  const candidate = identity?.['legacy-user'] || identity?.legacy_user || identity?.user || identity?.data || identity;
  const user = candidate && typeof candidate === 'object' ? { ...candidate } : {};
  const legacyUserId = identity?.['legacy-user-id'] || identity?.legacy_user_id || identity?.user_id;
  if (!user.id && legacyUserId) user.id = legacyUserId;
  if (!user.has_verified_email) user.has_verified_email = true;
  return user;
}

function hyperbeamProductMethod(resource: string, action: string) {
  return `${resource}_${action}`.replace(/[^a-zA-Z0-9_]+/g, '_');
}

function hyperbeamOptionalApiFallback(resource: string, action: string, params: any) {
  if (resource === 'membership_v2' && action === 'list') return [];
  if (resource === 'membership_v2' && action === 'check') return {};
  if (resource === 'membership_v2/subscription' && action === 'list') return [];
  if (resource === 'user' && action === 'has_premium') return {};
  if (resource === 'user' && action === 'invite_status') {
    return {
      invitees: [],
      invites_remaining: 0,
    };
  }
  if (resource === 'user' && action === 'view_history') {
    return {
      has_more: false,
      items: [],
      page: params?.page || 1,
    };
  }
  if (resource === 'user' && action === 'view_history/delete') return {};
  if (resource === 'user_referral_code' && action === 'list') return '';
  if (resource === 'account' && action === 'check') return {};
  if (resource === 'account' && action === 'status') {
    return {
      arweave: {
        addresses: [],
        default_address: null,
      },
      stripe: null,
    };
  }
  if (resource === 'reaction' && action === 'list') return {};
  if (resource === 'customer' && action === 'status') return null;
  if (resource === 'reward' && action === 'list') return [];
  if (resource === 'reward' && action === 'list_featured') return [];
  if (resource === 'notification' && action === 'list') return [];
  if (resource === 'notification' && action === 'categories') return [];
  if (resource === 'file' && action === 'last_positions') return {};
  if (resource === 'file' && action === 'view_count') {
    const claimIds = String(params?.claim_id || params?.claim_ids || '')
      .split(',')
      .filter(Boolean);
    return Object.fromEntries(claimIds.map((claimId) => [claimId, 0]));
  }
  if (resource === 'subscription' && action === 'sub_count') {
    const claimIds = String(params?.claim_id || params?.claim_ids || '')
      .split(',')
      .filter(Boolean);
    return Object.fromEntries(claimIds.map((claimId) => [claimId, 0]));
  }
  return undefined;
}

function hyperbeamFallbackFor(resource: string, action: string, params: any) {
  return isHyperbeamEnabled() ? hyperbeamOptionalApiFallback(resource, action, params) : undefined;
}

function hyperbeamNodeProductApiCall(
  resource: string,
  action: string,
  params: any = {},
  authToken: string | null = null
) {
  const nodeParams = authToken ? { auth_token: authToken, ...params } : params;

  return hyperbeamNodeFetchJson(hyperbeamProductMethod(resource, action), nodeParams, authToken);
}

function hyperbeamNativeProductApiCall(resource: string, action: string, params: any = {}) {
  if (resource === 'file' && action === 'view_count') {
    return hyperbeamDeviceFetchJson(HYPERBEAM_DEVICE.file, 'view-count', params);
  }
  if (resource === 'subscription' && action === 'sub_count') {
    return hyperbeamDeviceFetchJson(HYPERBEAM_DEVICE.subscription, 'sub-count', params);
  }
  if (resource === 'reaction' && action === 'list') {
    return hyperbeamDeviceFetchJson(HYPERBEAM_DEVICE.reaction, 'list', params);
  }
  return null;
}

// We can't use env's because they aren't passed into node_modules
Lbryio.setLocalApi = (endpoint) => {
  Lbryio.CONNECTION_STRING = endpoint.replace(/\/*$/, '/'); // exactly one slash at the end;
};

Lbryio.call = (resource, action, params = {}, method = 'post', noAuth = false) => {
  if (!Lbryio.enabled) {
    return Promise.reject(new Error(__('LBRY internal API is disabled')));
  }

  if (!(method === 'get' || method === 'post')) {
    return Promise.reject(new Error(__('Invalid method')));
  }

  function checkAndParse(response) {
    if (response.status >= 200 && response.status < 300) {
      return response.json();
    }

    if (response.status === 500) {
      if (resource === 'membership_v2' && action === 'update') {
        return response.json().then((json) => {
          if (json?.error?.match(/.*Duplicate entry.*membership_v2.idx_user_publish_name_unique'/)) {
            return Promise.reject(
              "Please try a different tier name, something you haven't used before on prior (even deleted memberships)."
            );
          }

          return Promise.reject(INTERNAL_APIS_DOWN);
        });
      }

      return Promise.reject(INTERNAL_APIS_DOWN);
    }

    if (response) {
      return response.json().then((json) => {
        let error;

        if (json.error) {
          error = new Error(json.error);
        } else if (json.success === false) {
          if (json.data) {
            error = new Error(json.data);
          } else {
            error = new Error('Unknown API error signature');
          }
        } else {
          error = new Error('Unknown API error signature');
        }

        error.response = response; // This is primarily a hack used in actions/user.js

        return Promise.reject(error);
      });
    }
  }

  function makeRequest(url, options) {
    return fetch(url, options).then(checkAndParse);
  }

  return Lbryio.getAuthToken().then((token) => {
    const nodeAuthToken = noAuth ? null : token;
    const directRequest = () => {
      const fullParams = {
        auth_token: token,
        ...params,
      };
      Object.keys(fullParams).forEach((key) => {
        const value = fullParams[key];

        if (typeof value === 'object') {
          fullParams[key] = JSON.stringify(value);
        }
      });
      const qs = new URLSearchParams(fullParams).toString();
      let url = `${Lbryio.CONNECTION_STRING}${resource}/${action}?${qs}`;
      let options = {
        method: 'GET',
      };

      if (method === 'post') {
        options = {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: qs,
        } as any;
        url = `${Lbryio.CONNECTION_STRING}${resource}/${action}`;
      }

      return makeRequest(url, options)
        .then((response) => {
          sendCallAnalytics(resource, action, params);
          return response.data;
        })
        .catch((error) => {
          const fallback = hyperbeamFallbackFor(resource, action, params);
          if (
            fallback !== undefined &&
            (!error?.response || error?.response?.status === 401 || error?.response?.status === 403)
          ) {
            return fallback;
          }
          sendFailedCallAnalytics(resource, action, params, error);
          throw error;
        });
    };

    const nativeProductRequest = hyperbeamNativeProductApiCall(resource, action, params);
    if (nativeProductRequest) {
      return nativeProductRequest
        .then((response) => {
          sendCallAnalytics(resource, action, params);
          return response;
        })
        .catch((error) => {
          const fallback = hyperbeamFallbackFor(resource, action, params);
          if (fallback !== undefined) {
            return fallback;
          }
          sendFailedCallAnalytics(resource, action, params, error);
          throw error;
        });
    }

    if (hyperbeamNodeConfigured()) {
      return hyperbeamNodeProductApiCall(resource, action, params, nodeAuthToken)
        .then((response) => {
          sendCallAnalytics(resource, action, params);
          return response;
        })
        .catch((error) => {
          const fallback = hyperbeamFallbackFor(resource, action, params);
          if (fallback !== undefined) {
            return fallback;
          }
          sendFailedCallAnalytics(resource, action, params, error);
          throw error;
        });
    }

    const fallback = hyperbeamFallbackFor(resource, action, params);
    if (fallback !== undefined) {
      return Promise.resolve(fallback);
    }
    if (!shouldAllowOriginalNetworkFallback()) {
      return Promise.reject(new Error(`HyperBEAM product API device is not configured for ${resource}/${action}`));
    }

    return directRequest();
  });
};

Lbryio.authToken = null;

Lbryio.getAuthToken = () =>
  new Promise((resolve) => {
    if (Lbryio.authToken) {
      resolve(Lbryio.authToken);
    } else if (Lbryio.overrides.getAuthToken) {
      Lbryio.overrides.getAuthToken().then((token) => {
        resolve(token);
      });
    } else if (typeof window !== 'undefined') {
      const savedAuthToken = getSavedAuthToken();

      if (savedAuthToken) {
        Lbryio.authToken = savedAuthToken;
        resolve(savedAuthToken);
        return;
      }

      const { store } = window;

      if (store) {
        const state = store.getState();
        const token = state.auth ? state.auth.authToken : null;
        Lbryio.authToken = token;
        resolve(token);
      }

      resolve(null);
    } else {
      resolve(null);
    }
  });

Lbryio.getCurrentUser = () =>
  Lbryio.getAuthToken().then((token) => {
    if (isHyperbeamEnabled() && token) {
      const user = hyperbeamLegacyAuthUser(token);
      if (user) return user;
      return Promise.reject(new Error('HyperBEAM legacy auth device is not configured.'));
    }

    return Lbryio.call('user', 'me');
  });

Lbryio.authenticate = (domain, language) => {
  if (!Lbryio.enabled) {
    const params = {
      id: 1,
      primary_email: 'disabled@lbry.io',
      has_verified_email: true,
      is_identity_verified: true,
      is_reward_approved: false,
      language: language || 'en',
    };
    return new Promise((resolve) => {
      resolve(params);
    });
  }

  if (Lbryio.authenticationPromise === null) {
    Lbryio.authenticationPromise = new Promise((resolve, reject) => {
      Lbryio.getAuthToken()
        .then((token) => {
          if (!token || token.length > 60) {
            return false;
          }

          // check that token works
          return Lbryio.getCurrentUser()
            .then((user) => user)
            .catch((error) => {
              if (error === INTERNAL_APIS_DOWN) {
                throw new Error('Internal APIS down');
              }

              return false;
            });
        })
        .then((user) => {
          if (user) {
            return user;
          }

          return Lbry.status()
            .then(
              (status) =>
                new Promise((res, rej) => {
                  const appId =
                    domain && domain !== 'lbry.tv'
                      ? (domain.replace(/[.]/gi, '') + status.installation_id).slice(0, 66)
                      : status.installation_id;
                  Lbryio.call(
                    'user',
                    'new',
                    {
                      auth_token: '',
                      language: language || 'en',
                      app_id: appId,
                    },
                    'post'
                  )
                    .then((response) => {
                      if (!response.auth_token) {
                        throw new Error('auth_token was not set in the response');
                      }

                      const { store } = window;

                      if (Lbryio.overrides.setAuthToken) {
                        Lbryio.overrides.setAuthToken(response.auth_token);
                      }

                      if (store) {
                        store.dispatch({
                          type: ACTIONS.GENERATE_AUTH_TOKEN_SUCCESS,
                          data: {
                            authToken: response.auth_token,
                          },
                        });
                      }

                      Lbryio.authToken = response.auth_token;
                      return res(response);
                    })
                    .catch((error) => rej(error));
                })
            )
            .then((newUser) => {
              if (!newUser) {
                return Lbryio.getCurrentUser();
              }

              return newUser;
            });
        })
        .then(resolve, reject);
    });
  }

  return Lbryio.authenticationPromise;
};

Lbryio.getStripeToken = () =>
  Lbryio.CONNECTION_STRING.startsWith('http://localhost:')
    ? 'pk_test_NoL1JWL7i1ipfhVId5KfDZgo'
    : 'pk_live_e8M4dRNnCCbmpZzduEUZBgJO';

Lbryio.getExchangeRates = () => {
  if (!Lbryio.exchangeLastFetched || Date.now() - Lbryio.exchangeLastFetched > EXCHANGE_RATE_TIMEOUT) {
    Lbryio.exchangePromise = new Promise((resolve, reject) => {
      Lbryio.call('lbc', 'exchange_rate', {}, 'post', true)
        .then(({ lbc_usd: LBC_USD, lbc_btc: LBC_BTC, btc_usd: BTC_USD }) => {
          const rates = {
            LBC_USD,
            LBC_BTC,
            BTC_USD,
          };
          resolve(rates);
        })
        .catch(reject);
    });
    Lbryio.exchangeLastFetched = Date.now();
  }

  return Lbryio.exchangePromise;
};

// Allow overriding lbryio methods
// The desktop app will need to use it for getAuthToken because we use electron's ipcRenderer
Lbryio.overrides = {};

Lbryio.setOverride = (methodName, newMethod) => {
  Lbryio.overrides[methodName] = newMethod;
};

function sendCallAnalytics(resource, action, params) {
  switch (resource) {
    case 'customer':
      if (action === 'tip') {
        analytics.event.report('spend_virtual_currency', {
          // https://developers.google.com/analytics/devguides/collection/ga4/reference/events#spend_virtual_currency
          value: params.amount,
          virtual_currency_name: params.currency.toLowerCase(),
          item_name: 'tip',
        });
      }

      break;

    default:
      // Do nothing
      break;
  }
}

function sendFailedCallAnalytics(resource, action, params, error) {
  if ((resource === 'customer' && action === 'status') || (resource === 'user' && action === 'referral')) {
    // Ignore commands that we use the error as a value, or don't care if it fails.
    return;
  }

  // @if TARGET='DISABLE_FOR_NOW'
  const options = {
    fingerprint: 'internal-api-failures',
    tags: {
      analytics: true,
      method: `${resource}/${action}`,
    },
    extra: {
      error,
      params,
    },
  };
  analytics.log('Internal API failures', options as any, 'analytics'); // @endif
}

export default Lbryio;
