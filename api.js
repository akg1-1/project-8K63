// api.js
(function () {
    'use strict';

    var API_BASE = (function () {
        if (window.CASHFY_API_BASE != null) return window.CASHFY_API_BASE;
        // Если фронт крутится на другом порту — считаем, что API на :8000
        if (location.port && location.port !== '8000') {
            return location.protocol + '//' + location.hostname + ':8000';
        }
        return '';
    })();

    var TOKEN_KEY = 'cashfy.token.v1';

    function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }
    function setToken(t) {
        if (t) localStorage.setItem(TOKEN_KEY, t);
        else localStorage.removeItem(TOKEN_KEY);
    }

    function req(path, opts) {
        opts = opts || {};
        var headers = Object.assign(
            { 'Content-Type': 'application/json' },
            opts.headers || {}
        );
        var tok = getToken();
        if (tok) headers['Authorization'] = 'Bearer ' + tok;

        return fetch(API_BASE + '/api' + path, {
            method: opts.method || 'GET',
            headers: headers,
            body: opts.body != null ? JSON.stringify(opts.body) : undefined,
        }).then(function (r) {
            return r.json().catch(function () { return {}; }).then(function (data) {
                if (!r.ok) {
                    var err = new Error((data && data.detail) || ('HTTP ' + r.status));
                    err.status = r.status;
                    throw err;
                }
                return data;
            });
        });
    }

    window.CashfyAPI = {
        register: function (name, password) {
            return req('/auth/register', { method: 'POST', body: { name: name, password: password } });
        },
        login: function (name, password) {
            return req('/auth/login', { method: 'POST', body: { name: name, password: password } });
        },
        guest: function () { return req('/auth/guest', { method: 'POST' }); },
        logout: function () { return req('/auth/logout', { method: 'POST' }).catch(function () { }); },
        me: function () { return req('/auth/me'); },
        deleteMe: function () { return req('/auth/me', { method: 'DELETE' }); },

        getState: function () { return req('/state'); },
        putState: function (s) { return req('/state', { method: 'PUT', body: s }); },
        stats: function (month) {
            return req('/stats' + (month ? '?month=' + encodeURIComponent(month) : ''));
        },

        getToken: getToken,
        setToken: setToken,
        clearToken: function () { setToken(''); },
    };
})();