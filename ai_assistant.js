(function () {
    'use strict';

    // ===================================================================
    //  AI ASSISTANT v5.0 for Lampa
    //  Original author: @bodya_elven
    //  Architecture v5.0: MiF + Claude (Anthropic)
    //  UI language: Ukrainian
    // ===================================================================

    var PLUGIN_VERSION = '5.0';

    var PLUGIN_ICON = '<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><style>.cls-left{fill:currentColor;fill-rule:evenodd;}.cls-right{fill:#a0a0a0;fill-rule:evenodd;}</style><g><polygon class="cls-right" points="16.64 15.13 17.38 13.88 20.91 13.88 22 12 19.82 8.25 16.75 8.25 15.69 6.39 14.5 6.39 14.5 5.13 16.44 5.13 17.5 7 19.09 7 16.9 3.25 12.63 3.25 12.63 8.25 14.36 8.25 15.09 9.5 12.63 9.5 12.63 12 14.89 12 15.94 10.13 18.75 10.13 19.47 11.38 16.67 11.38 15.62 13.25 12.63 13.25 12.63 17.63 16.03 17.63 15.31 18.88 12.63 18.88 12.63 20.75 16.9 20.75 20.18 15.13 18.09 15.13 17.36 16.38 14.5 16.38 14.5 15.13 16.64 15.13"/><polygon class="cls-left" points="7.36 15.13 6.62 13.88 3.09 13.88 2 12 4.18 8.25 7.25 8.25 8.31 6.39 9.5 6.39 9.5 5.13 7.56 5.13 6.5 7 4.91 7 7.1 3.25 11.38 3.25 11.38 8.25 9.64 8.25 8.91 9.5 11.38 9.5 11.38 12 9.11 12 8.06 10.13 5.25 10.13 4.53 11.38 7.33 11.38 8.38 13.25 11.38 13.25 11.38 17.63 7.97 17.63 8.69 18.88 11.38 18.88 11.38 20.75 7.1 20.75 3.82 15.13 5.91 15.13 6.64 16.38 9.5 16.38 9.5 15.13 7.36 15.13"/></g></svg>';

    // Gemini: strongest to weakest
    // NOTE: gemini-3.1-flash-lite-preview shutdown by Google 25.05.2026
    var GEMINI_MODELS = [
        'gemini-2.5-flash',
        'gemini-3-flash-preview',
        'gemini-2.5-flash-lite',
        'gemini-3.1-flash-lite',
    ];

    // OpenRouter: strongest to weakest for movie tasks
    // ОНОВЛЕНО (червень 2026): deepseek/deepseek-r1:free БІЛЬШЕ НЕ БЕЗКОШТОВНА —
    // підтверджено кількома незалежними джерелами (aireiter.com, betonai.net), модель
    // прибрано з :free тарифу OpenRouter. Замінено на живі альтернативи станом на 06.2026.
    // Список ротується — якщо за кілька місяців модель знову зникне, Provider Manager
    // просто перейде на наступну в черзі (це штатна поведінка, не критична помилка).
    var OPENROUTER_MODELS = [
        'google/gemma-4-31b-it:free',
        'openai/gpt-oss-120b:free',
        'meta-llama/llama-4-maverick:free',
        'meta-llama/llama-4-scout:free',
        'openai/gpt-oss-20b:free',
        'meta-llama/llama-3.3-70b-instruct:free',
    ];

    // Cache TTL in milliseconds
    var CACHE_TTL = {
        facts:           7 * 864e5,
        recommendations: 3 * 864e5,
        tags:           14 * 864e5,
        recap:           7 * 864e5,
        search:          1 * 864e5,
    };

    // Provider TTL after failure
    var PROVIDER_TTL = {
        gemini:     24 * 36e5,
        openrouter: 20 * 6e4,
    };

    // Таймаут на ОДИН fetch-запит до AI провайдера (мс). Без цього зависла мережево
    // модель блокувала б весь ланцюжок fallback на необмежений час (дефолтний
    // browser timeout для fetch часто 300+ секунд). 15с — достатньо для відповіді
    // швидкої моделі (зазвичай 2-8с), але не змушує користувача довго чекати
    // переходу на наступну модель якщо ця "висне" на мережевому рівні.
    var REQUEST_TIMEOUT_MS = 15000;

    // Storage keys
    var SK = {
        gemini_key:     'google_native_key_v1',
        openrouter_key: 'openrouter_key_v1',
        provider_mode:  'ai_provider_mode',
        provider_state: 'ai_provider_state_v2',
        cache_prefix:   'ai_cache_v5_',
        blocklist:      'ai_blocklist_v1',
        result_count:   'ai_result_count',
        font_size:      'ai_font_size',
        debug_mode:     'ai_debug_mode',
    };

    // Output contract schemas
    var SCHEMAS = {
        recommendation: { uk: 'string', orig: 'string', year: 'number' },
        fact:           { title: 'string', text: 'string' },
        recap:          { point: 'string' },
        search:         { uk: 'string', orig: 'string', year: 'number' },
    };

    // TMDB genre ID to name map
    var GENRE_NAMES = {
        28:'Action', 12:'Adventure', 16:'Animation', 35:'Comedy',
        80:'Crime', 99:'Documentary', 18:'Drama', 10751:'Family',
        14:'Fantasy', 36:'History', 27:'Horror', 10402:'Music',
        9648:'Mystery', 10749:'Romance', 878:'Science Fiction',
        53:'Thriller', 10752:'War', 37:'Western'
    };

    // Debug logger
    var dbg = {
        log: function () {
            try {
                // SK.debug_mode зберігається як рядок 'true'/'false' через select-параметр Lampa
                // Тому порівнюємо саме з рядком 'true', а не покладаємось на truthy/falsy рядка
                if (Lampa.Storage.get(SK.debug_mode, 'false') !== 'true') return;
                var a = Array.prototype.slice.call(arguments);
                a.unshift('[AI v5.0]');
                console.log.apply(console, a);
            } catch (e) {}
        }
    };

    // -------------------------------------------------------------------
    //  GLOBAL STATE
    // -------------------------------------------------------------------

    window.ai_pagination = {
        base_prompt: '', exclude_list: [], exclude_ids: [],
        preloaded_results: null, preloaded_raw_list: null,
        is_loading: false, is_preloading: false
    };
    window.ai_cached_results   = [];
    window.ai_active_controller = null;

    if (!window.ai_push_patched) {
        var _origPush = Lampa.Activity.push;
        Lampa.Activity.push = function (obj) {
            var card = obj.card || obj.movie;
            if (card && card.is_load_more) {
                if (window.plugin_ai_assistant_instance)
                    window.plugin_ai_assistant_instance.loadMore(Lampa.Activity.active());
                return;
            }
            _origPush.apply(Lampa.Activity, arguments);
        };
        window.ai_push_patched = true;
    }

    if (window.Lampa && Lampa.Api) {
        Lampa.Api.sources.ai_assistant_list = {
            list: function (params, oncomplite) {
                oncomplite({ results: window.ai_cached_results, total_pages: 1 });
            }
        };
    }

    // ===================================================================
    //  MAIN CLASS
    // ===================================================================

    function AIAssistantPlugin() {
        var _this = this;
        var statusBox = null;

        this.init = function () {
            _this.checkProviderRecovery();
            // Очищаємо протухлі кеш-записи при старті — запобігає переповненню localStorage
            setTimeout(function () { _this.cachePurgeExpired(); }, 3000);
            _this.setupSettings();
            _this.injectStyles();
            _this.setupGlobalSearch();

            Lampa.Listener.follow('full', function (e) {
                if (e.type === 'complite' || e.type === 'complete') {
                    _this.drawButton(e.object.activity.render(), e.data.movie);
                    _this.preloadTags(e.data.movie);
                }
            });

            Lampa.Listener.follow('card', function (e) {
                if (e.action === 'render' && e.card) {
                    if (e.card.is_load_more) {
                        e.element.attr('data-id', 'ai_load_more');
                        e.element.find('.card__title,.card__age,.item__title,.item__age,.card__vote,.card__icons').hide();
                    } else if (e.card.id) {
                        e.element.attr('data-id', e.card.id);
                    }
                }
            });
        };

        // -------------------------------------------------------------------
        //  JSON REPAIR LAYER (priority #1)
        // -------------------------------------------------------------------

        this.parseJsonSafe = function (text) {
            if (!text || typeof text !== 'string') return null;

            // Level 1: direct parse
            try { var r = JSON.parse(text); if (r) { dbg.log('JSON: direct OK'); return r; } } catch (e) {}

            // Level 2a: greedy array extraction (greedy not lazy!)
            var mArr = text.match(/\[[\s\S]*\]/);
            if (mArr) {
                try {
                    var r2 = JSON.parse(mArr[0]);
                    if (Array.isArray(r2) && r2.length > 0) { dbg.log('JSON: array regex OK'); return r2; }
                } catch (e) {}
            }

            // Level 2b: object extraction, look for array inside
            var mObj = text.match(/\{[\s\S]*\}/);
            if (mObj) {
                try {
                    var obj = JSON.parse(mObj[0]);
                    var keys = Object.keys(obj);
                    for (var i = 0; i < keys.length; i++) {
                        if (Array.isArray(obj[keys[i]]) && obj[keys[i]].length > 0) {
                            dbg.log('JSON: found array in field "' + keys[i] + '" OK');
                            return obj[keys[i]];
                        }
                    }
                } catch (e) {}
            }

            // Level 3: strip markdown
            var clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
            try { var r3 = JSON.parse(clean); if (r3) { dbg.log('JSON: after markdown strip OK'); return r3; } } catch (e) {}

            dbg.log('JSON: all levels failed. Sample:', text.slice(0, 150));
            return null;
        };

        // -------------------------------------------------------------------
        //  STRUCTURED OUTPUT CONTRACT
        // -------------------------------------------------------------------

        this.applyContract = function (array, schemaName) {
            var schema = SCHEMAS[schemaName];
            if (!schema || !Array.isArray(array)) return [];
            var valid = array.filter(function (item) {
                if (!item || typeof item !== 'object') return false;
                return Object.keys(schema).every(function (key) {
                    if (!(key in item)) return false;
                    if (schema[key] === 'number') return !isNaN(Number(item[key]));
                    return typeof item[key] === 'string' && item[key].trim().length > 0;
                });
            });
            dbg.log('Contract "' + schemaName + '": ' + array.length + ' -> ' + valid.length);
            return valid;
        };

        // -------------------------------------------------------------------
        //  CACHE LAYER (GET always first, before any AI call)
        // -------------------------------------------------------------------

        this.cacheKey = function (action, id) { return SK.cache_prefix + action + '_' + id; };

        this.cacheGet = function (action, id) {
            try {
                var raw = Lampa.Storage.get(_this.cacheKey(action, id), '');
                if (!raw) return null;
                var e = JSON.parse(raw);
                if (!e || e.version !== PLUGIN_VERSION) return null;
                if (Date.now() - e.timestamp > (CACHE_TTL[action] || CACHE_TTL.recommendations)) {
                    dbg.log('Cache "' + action + '_' + id + '": expired');
                    return null;
                }
                dbg.log('Cache "' + action + '_' + id + '": HIT');
                return e.data;
            } catch (e) { return null; }
        };

        this.cacheSet = function (action, id, data) {
            try {
                var key = _this.cacheKey(action, id);
                var entry = JSON.stringify({ data: data, timestamp: Date.now(), version: PLUGIN_VERSION });
                try {
                    Lampa.Storage.set(key, entry);
                    dbg.log('Cache "' + action + '_' + id + '": saved');
                } catch (e) {
                    // QuotaExceededError — localStorage переповнений.
                    // Видаляємо всі протухлі записи нашого плагіна і пробуємо ще раз.
                    dbg.log('Cache: QuotaExceededError — очищаємо протухлі записи...');
                    _this.cachePurgeExpired();
                    try { Lampa.Storage.set(key, entry); }
                    catch (e2) { dbg.log('Cache: не вдалось зберегти навіть після очистки'); }
                }
            } catch (e) { dbg.log('Cache save error:', e.message); }
        };

        this.cachePurgeExpired = function () {
            try {
                var prefix = SK.cache_prefix;
                // Lampa.Storage використовує localStorage — перебираємо ключі
                var ls = window.localStorage;
                if (!ls) return;
                var toDelete = [];
                for (var i = 0; i < ls.length; i++) {
                    var k = ls.key(i);
                    if (!k || k.indexOf(prefix) !== 0) continue;
                    try {
                        var entry = JSON.parse(ls.getItem(k));
                        if (!entry || !entry.timestamp) { toDelete.push(k); continue; }
                        // Визначаємо тип з ключа (ai_cache_v5_{action}_{id})
                        var parts = k.replace(prefix, '').split('_');
                        var actionType = parts[0];
                        var ttl = CACHE_TTL[actionType] || CACHE_TTL.recommendations;
                        if (Date.now() - entry.timestamp > ttl) toDelete.push(k);
                    } catch (e) { toDelete.push(k); }
                }
                toDelete.forEach(function (k) { try { ls.removeItem(k); } catch(e){} });
                dbg.log('Cache purge: видалено ' + toDelete.length + ' протухлих записів');
            } catch (e) { dbg.log('Cache purge error:', e.message); }
        };

        // -------------------------------------------------------------------
        //  PROVIDER MANAGER
        // -------------------------------------------------------------------

        this.getProviderState = function () {
            try {
                var raw = Lampa.Storage.get(SK.provider_state, '');
                return raw ? JSON.parse(raw) : { gemini_failed_at: null, openrouter_failed_at: null };
            } catch (e) { return { gemini_failed_at: null, openrouter_failed_at: null }; }
        };

        this.saveProviderState = function (s) {
            try { Lampa.Storage.set(SK.provider_state, JSON.stringify(s)); } catch (e) {}
        };

        this.setProviderFailed = function (provider) {
            var s = _this.getProviderState();
            s[provider + '_failed_at'] = Date.now();
            _this.saveProviderState(s);
            dbg.log('Provider "' + provider + '" marked unavailable');
        };

        this.isProviderAvailable = function (provider) {
            var s = _this.getProviderState();
            var failedAt = s[provider + '_failed_at'];
            if (!failedAt) return true;
            var recovered = (Date.now() - failedAt) > PROVIDER_TTL[provider];
            if (recovered) {
                s[provider + '_failed_at'] = null;
                _this.saveProviderState(s);
                dbg.log('Provider "' + provider + '" auto-recovered');
            }
            return recovered;
        };

        this.checkProviderRecovery = function () {
            var s = _this.getProviderState();
            var changed = false;
            ['gemini', 'openrouter'].forEach(function (p) {
                if (s[p + '_failed_at'] && (Date.now() - s[p + '_failed_at']) > PROVIDER_TTL[p]) {
                    s[p + '_failed_at'] = null;
                    changed = true;
                }
            });
            if (changed) _this.saveProviderState(s);
        };

        this.getActiveProviderName = function () {
            var mode = Lampa.Storage.get(SK.provider_mode, 'auto');
            if (mode === 'gemini_only') return 'Gemini';
            if (mode === 'openrouter_only') return 'OpenRouter';
            if (Lampa.Storage.get(SK.gemini_key, '') && _this.isProviderAvailable('gemini')) return 'Gemini';
            if (Lampa.Storage.get(SK.openrouter_key, '') && _this.isProviderAvailable('openrouter')) return 'OpenRouter';
            return '\u041D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u0438\u0439';
        };

        this.requestGemini = function (prompt, keys, modelIdx, useGrounding, onSuccess, onNextProvider) {
            if (modelIdx >= GEMINI_MODELS.length) { _this.setProviderFailed('gemini'); onNextProvider(); return; }
            var model = GEMINI_MODELS[modelIdx];
            var keyIdx = 0;

            var tryKey = function () {
                if (keyIdx >= keys.length) {
                    _this.requestGemini(prompt, keys, modelIdx + 1, useGrounding, onSuccess, onNextProvider);
                    return;
                }
                var payload = { contents: [{ parts: [{ text: prompt }] }] };
                if (useGrounding && model.indexOf('gemini-2.5') === 0) {
                    // КРИТИЧНО: при прямому REST виклику (без офіційного @google/genai SDK)
                    // поле має бути snake_case "google_search", а не camelCase "googleSearch".
                    // Офіційна документація ai.google.dev для REST/curl показує точний формат:
                    // "tools": [{"google_search": {}}]. SDK сам конвертує camelCase->snake_case,
                    // але ми робимо raw fetch() — тому googleSearch ігнорувався Google API,
                    // і Grounding фактично НІКОЛИ не вмикався попри прапорець useGrounding.
                    payload.tools = [{ google_search: {} }];
                    dbg.log('Gemini: Grounding увімкнено для ' + model);
                }
                var t0 = Date.now();
                // Ручний AbortController (не AbortSignal.timeout()) — для сумісності
                // зі старими Android WebView на Lampa-приставках. Без таймауту зависла
                // мережево модель блокувала б весь ланцюжок fallback необмежено довго.
                var abortCtrl1 = new AbortController();
                var abortTimer1 = setTimeout(function () { abortCtrl1.abort(); }, REQUEST_TIMEOUT_MS);

                fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + keys[keyIdx], {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                    signal: abortCtrl1.signal
                })
                .then(function (r) { clearTimeout(abortTimer1); return r.json().then(function (j) { return { status: r.status, ok: r.ok, data: j }; }); })
                .then(function (res) {
                    dbg.log('Gemini ' + model + ': ' + res.status + ' (' + (Date.now()-t0) + 'ms)');
                    if (res.status === 429 || res.status === 503) { keyIdx++; tryKey(); return; }
                    if (res.status === 404) { _this.requestGemini(prompt, keys, modelIdx+1, useGrounding, onSuccess, onNextProvider); return; }
                    if (!res.ok) { keyIdx++; tryKey(); return; }
                    if (res.data.candidates && res.data.candidates[0] && res.data.candidates[0].content) {
                        var text = res.data.candidates[0].content.parts.map(function(p){ return p.text||''; }).join('\n');
                        dbg.log('Gemini: success via ' + model);
                        onSuccess(text);
                    } else { keyIdx++; tryKey(); }
                })
                .catch(function (err) {
                    clearTimeout(abortTimer1);
                    if (err.name === 'AbortError') dbg.log('Gemini ' + model + ': timeout ' + REQUEST_TIMEOUT_MS + 'ms');
                    keyIdx++; tryKey();
                });
            };
            tryKey();
        };

        this.requestOpenRouter = function (prompt, key, modelIdx, onSuccess, onAllFailed) {
            if (modelIdx >= OPENROUTER_MODELS.length) { _this.setProviderFailed('openrouter'); onAllFailed(); return; }
            var model = OPENROUTER_MODELS[modelIdx];
            var t0 = Date.now();
            var abortCtrl2 = new AbortController();
            var abortTimer2 = setTimeout(function () { abortCtrl2.abort(); }, REQUEST_TIMEOUT_MS);

            fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://lampa.mx', 'X-Title': 'AI Assistant for Lampa' },
                body: JSON.stringify({ model: model, messages: [{ role: 'user', content: prompt }], max_tokens: 4096 }),
                signal: abortCtrl2.signal
            })
            .then(function (r) { clearTimeout(abortTimer2); return r.json().then(function (j) { return { status: r.status, ok: r.ok, data: j }; }); })
            .then(function (res) {
                dbg.log('OpenRouter ' + model + ': ' + res.status + ' (' + (Date.now()-t0) + 'ms)');
                if (res.status === 429 || res.status === 503 || res.status === 402) { _this.requestOpenRouter(prompt, key, modelIdx+1, onSuccess, onAllFailed); return; }
                if (!res.ok) { _this.requestOpenRouter(prompt, key, modelIdx+1, onSuccess, onAllFailed); return; }
                if (res.data.choices && res.data.choices[0] && res.data.choices[0].message) {
                    dbg.log('OpenRouter: success via ' + model);
                    onSuccess(res.data.choices[0].message.content);
                } else { _this.requestOpenRouter(prompt, key, modelIdx+1, onSuccess, onAllFailed); }
            })
            .catch(function (err) {
                clearTimeout(abortTimer2);
                if (err.name === 'AbortError') dbg.log('OpenRouter ' + model + ': timeout ' + REQUEST_TIMEOUT_MS + 'ms');
                _this.requestOpenRouter(prompt, key, modelIdx+1, onSuccess, onAllFailed);
            });
        };

        this.request = function (prompt, onSuccess, onError, options) {
            options = options || {};
            var useGrounding = options.useGrounding || false;
            var isSilent     = options.isSilent || false;
            // geminiOnly: for recap/facts — OR models hallucinate specific plots
            var geminiOnly   = options.geminiOnly || false;

            var geminiRaw = Lampa.Storage.get(SK.gemini_key, '');
            var orKey     = Lampa.Storage.get(SK.openrouter_key, '');
            var mode      = Lampa.Storage.get(SK.provider_mode, 'auto');

            var geminiKeys = geminiRaw ? geminiRaw.split(',').map(function(k){ return k.trim(); }).filter(Boolean) : [];
            var hasGemini = geminiKeys.length > 0;
            var hasOR     = !!orKey;

            if (!hasGemini && !hasOR) {
                if (!isSilent) Lampa.Noty.show('\u0428\u0406 \u0441\u043F\u0438\u0442\u044C \uD83D\uDE34 \u0414\u043E\u0434\u0430\u0439\u0442\u0435 API \u043A\u043B\u044E\u0447 \u0443 \u043D\u0430\u043B\u0430\u0448\u0442\u0443\u0432\u0430\u043D\u043D\u044F\u0445');
                if (onError) onError('no_keys');
                return;
            }

            var canGemini = hasGemini && (mode === 'auto' || mode === 'gemini_only') && _this.isProviderAvailable('gemini');
            var canOR     = hasOR && (mode === 'auto' || mode === 'openrouter_only') && _this.isProviderAvailable('openrouter') && !geminiOnly;

            var handleAllFailed = function () {
                if (!isSilent) Lampa.Noty.show('\u041B\u0456\u043C\u0456\u0442\u0438 \u0432\u0438\u0447\u0435\u0440\u043F\u0430\u043D\u043E. \u0421\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u043F\u0456\u0437\u043D\u0456\u0448\u0435');
                if (onError) onError('all_failed');
            };

            var tryOR = function () {
                if (!canOR) { handleAllFailed(); return; }
                _this.requestOpenRouter(prompt, orKey, 0, onSuccess, handleAllFailed);
            };

            if (canGemini) _this.requestGemini(prompt, geminiKeys, 0, useGrounding, onSuccess, tryOR);
            else if (canOR) tryOR();
            else handleAllFailed();
        };

        // -------------------------------------------------------------------
        //  TASTE MEMORY
        //  Reads Lampa.Storage('favorite') — real bookmarks/likes/watchlist
        //  Structure: {card:[], like:[], wath:[], book:[], history:[]}
        // -------------------------------------------------------------------

        this.buildTasteProfile = function () {
            // Кешуємо профіль на 5 хвилин в пам'яті — favorite JSON може бути великим,
            // і парсити його при КОЖНОМУ AI запиті (рекомендації, пошук) зайве навантаження
            var now = Date.now();
            if (_this._tasteCacheTime && (now - _this._tasteCacheTime) < 5 * 60 * 1000) {
                return _this._tasteCacheValue;
            }
            try {
                var fav = Lampa.Storage.get('favorite', '');
                if (!fav) { _this._tasteCacheTime = now; _this._tasteCacheValue = null; return null; }
                var data = typeof fav === 'string' ? JSON.parse(fav) : fav;
                var allCards = [];
                ['card', 'like', 'wath', 'book'].forEach(function (key) {
                    if (data[key] && data[key].length) {
                        data[key].forEach(function (item) {
                            var c = item.card || item;
                            if (c && (c.title || c.name)) allCards.push(c);
                        });
                    }
                });
                if (allCards.length < 3) { _this._tasteCacheTime = now; _this._tasteCacheValue = null; return null; }

                // Top genres
                var genreCount = {};
                allCards.forEach(function (c) {
                    (c.genre_ids || []).forEach(function (gid) {
                        genreCount[gid] = (genreCount[gid] || 0) + 1;
                    });
                });
                var topGenres = Object.keys(genreCount)
                    .sort(function (a, b) { return genreCount[b] - genreCount[a]; })
                    .slice(0, 3)
                    .map(function (id) { return GENRE_NAMES[id]; })
                    .filter(Boolean);

                // Top decade
                var decadeCount = {};
                allCards.forEach(function (c) {
                    var y = parseInt((c.release_date || c.first_air_date || '').slice(0, 4));
                    if (y > 1900) { var d = Math.floor(y/10)*10; decadeCount[d] = (decadeCount[d]||0)+1; }
                });
                var topDecade = Object.keys(decadeCount).sort(function(a,b){ return decadeCount[b]-decadeCount[a]; })[0];

                // TV vs Movie preference
                var tvCount    = allCards.filter(function(c){ return c.name||c.original_name; }).length;
                var movieCount = allCards.length - tvCount;

                var result = {
                    genres: topGenres,
                    decade: topDecade ? topDecade + 's' : null,
                    prefers_tv:     tvCount > movieCount * 1.5,
                    prefers_movies: movieCount > tvCount * 1.5,
                    total: allCards.length
                };
                _this._tasteCacheTime = now;
                _this._tasteCacheValue = result;
                return result;
            } catch (e) {
                dbg.log('TasteMemory error:', e.message);
                _this._tasteCacheTime = now;
                _this._tasteCacheValue = null;
                return null;
            }
        };

        this.getTasteProfileLine = function () {
            var p = _this.buildTasteProfile();
            if (!p) return '';
            var parts = [];
            if (p.genres.length)    parts.push('preferred genres: ' + p.genres.join(', '));
            if (p.decade)           parts.push('often watches films from the ' + p.decade);
            if (p.prefers_tv)       parts.push('prefers TV series over movies');
            if (p.prefers_movies)   parts.push('prefers movies over TV series');
            if (!parts.length) return '';
            dbg.log('TasteMemory: profile built from ' + p.total + ' titles');
            return 'User taste profile (' + p.total + ' saved titles): ' + parts.join('; ') + '. Match this profile.';
        };

        // -------------------------------------------------------------------
        //  TMDB DISCOVER ROUTER
        //  Detects queries needing real data and routes to TMDB directly
        // -------------------------------------------------------------------

        this.tryTMDBDiscover = function (q, limit) {
            var lq = q.toLowerCase().trim();
            var currentYear = new Date().getFullYear();
            var yearMatch = lq.match(/\b(20[2-9][0-9])\b/);
            var queryYear = yearMatch ? parseInt(yearMatch[1]) : null;

            var isTop   = ['кращ','топ','найкращ','рейтинг','відгук','оцінк','best','top','rated'].some(function(k){ return lq.indexOf(k)>-1; });
            var isNew   = ['нов','свіж','останн','new','latest','recent'].some(function(k){ return lq.indexOf(k)>-1; });
            var isTrend = ['тренд','зараз','trending','популярн зараз','хіт'].some(function(k){ return lq.indexOf(k)>-1; });

            // Trending: direct /trending endpoint
            if (isTrend && !queryYear) {
                return function (callback) {
                    var mt  = lq.indexOf('\u0441\u0435\u0440\u0456\u0430\u043b') > -1 ? 'tv' : 'movie';
                    var url = 'https://api.themoviedb.org/3/trending/' + mt + '/week?api_key=' + Lampa.TMDB.key() + '&language=uk-UA';
                    dbg.log('TMDB Trending:', url);
                    Lampa.Network.silent(url, function (res) {
                        var results = (res.results || []).slice(0, parseInt(limit));
                        results.forEach(function(r){ r.source='tmdb'; });
                        callback(results);
                    }, function () { callback([]); });
                };
            }

            // Year-based: /discover with year filter
            if (!queryYear) return null;

            return function (callback) {
                var mt  = lq.indexOf('\u0441\u0435\u0440\u0456\u0430\u043b') > -1 ? 'tv' : 'movie';
                var sortBy = isTop ? 'vote_average.desc' : 'popularity.desc';
                var params = [
                    'api_key=' + Lampa.TMDB.key(),
                    'language=uk-UA',
                    'sort_by=' + sortBy,
                    'vote_count.gte=100',
                    'include_adult=false',
                    'page=1',
                    'primary_release_date.gte=' + queryYear + '-01-01',
                    'primary_release_date.lte=' + queryYear + '-12-31',
                ];
                var url = 'https://api.themoviedb.org/3/discover/' + mt + '?' + params.join('&');
                dbg.log('TMDB Discover:', url);
                Lampa.Network.silent(url, function (res) {
                    var results = (res.results || []).slice(0, parseInt(limit));
                    results.forEach(function(r){ r.source='tmdb'; });
                    callback(results);
                }, function () { callback([]); });
            };
        };

        // -------------------------------------------------------------------
        //  TMDB CONTEXT BUILDER — single source for all AI functions
        // -------------------------------------------------------------------

        this.buildTMDBContext = function (card, callback) {
            // Use cached context if available (saves time on repeated calls)
            if (card._ai_ctx) { dbg.log('TMDB ctx: from card cache'); callback(card._ai_ctx); return; }

            var method = (card.name || card.original_name) ? 'tv' : 'movie';
            var url = Lampa.TMDB.api(
                method + '/' + card.id +
                '?api_key=' + Lampa.TMDB.key() +
                '&language=en-US' +
                '&append_to_response=credits,keywords,external_ids'
            );

            var t0 = Date.now();
            Lampa.Network.silent(url, function (res) {
                dbg.log('TMDB ctx: loaded in ' + (Date.now()-t0) + 'ms');
                var ctx = {};
                ctx.title          = res.title || res.name || card.title || card.name || '';
                ctx.original_title = res.original_title || res.original_name || '';
                ctx.year           = (res.release_date || res.first_air_date || '').slice(0, 4);
                ctx.overview       = (res.overview || '').replace(/"/g, "'").replace(/\n/g, ' ').slice(0, 500);
                ctx.vote_average   = res.vote_average || 0;
                ctx.type           = method === 'tv' ? 'TV series' : 'movie';
                ctx.number_of_seasons      = res.number_of_seasons || null;
                ctx.belongs_to_collection  = res.belongs_to_collection || null;
                ctx.genres    = (res.genres || []).map(function(g){ return g.name; }).join(', ');
                ctx.countries = (res.production_countries || []).map(function(c){ return c.name; }).join(', ');
                ctx.collection = (res.belongs_to_collection || {}).name || '';
                ctx.imdb_id    = (res.external_ids || {}).imdb_id || '';
                ctx.director   = '';
                ctx.writers    = [];
                ctx.lead_actors = [];
                if (res.credits) {
                    var crew = res.credits.crew || [];
                    var dirObj = crew.find(function(c){ return c.job==='Director'; });
                    if (!dirObj && res.created_by && res.created_by.length) dirObj = res.created_by[0];
                    if (!dirObj) dirObj = crew.find(function(c){ return c.job==='Executive Producer'; });
                    ctx.director    = dirObj ? dirObj.name : '';
                    ctx.writers     = crew.filter(function(c){ return c.job==='Writer'||c.job==='Screenplay'||c.job==='Story'; }).slice(0,2).map(function(c){ return c.name; });
                    ctx.lead_actors = (res.credits.cast||[]).slice(0,3).map(function(c){ return c.name; });
                }
                var kwObj   = res.keywords || {};
                var kwArray = kwObj.keywords || kwObj.results || [];
                ctx.keywords_raw = kwArray.slice(0, 15);
                ctx.keywords     = kwArray.slice(0, 10).map(function(k){ return k.name; }).join(', ');

                // Write tags to card for tag menu
                if (kwArray.length > 0 && card.translated_tags === undefined) {
                    card.translated_tags = null;
                    _this.translateTags(ctx.keywords_raw.map(function(k){ return {name:k.name,id:k.id,orig_name:k.name}; }), function(tags){
                        card.translated_tags = tags;
                    });
                }

                if (ctx.belongs_to_collection && !card.belongs_to_collection) card.belongs_to_collection = ctx.belongs_to_collection;
                if (ctx.number_of_seasons && !card.number_of_seasons) card.number_of_seasons = ctx.number_of_seasons;

                card._ai_ctx = ctx; // Cache in card object
                callback(ctx);
            }, function () {
                dbg.log('TMDB ctx: fallback to card data');
                callback({
                    title: card.title||card.name||'', original_title: card.original_title||card.original_name||'',
                    year: (card.release_date||card.first_air_date||'').slice(0,4),
                    overview: (card.overview||'').slice(0,300),
                    type: (card.name||card.original_name) ? 'TV series' : 'movie',
                    genres:'', countries:'', director:'', writers:[], lead_actors:[],
                    keywords:'', keywords_raw:[], imdb_id:'', collection:'',
                    vote_average:0, belongs_to_collection: card.belongs_to_collection||null,
                    number_of_seasons: card.number_of_seasons||null,
                });
            });
        };

        // -------------------------------------------------------------------
        //  PROMPT BUILDER
        // -------------------------------------------------------------------

        this.getBlocklistPromptLine = function () {
            var bl = _this.getBlocklist();
            var parts = [];
            if (bl.genres     && bl.genres.length)     parts.push('genres: ' + bl.genres.join(', '));
            if (bl.franchises && bl.franchises.length)  parts.push('franchises: ' + bl.franchises.join(', '));
            return parts.length ? 'NEVER suggest these ' + parts.join(' and ') + '.' : '';
        };

        this.buildRecommendationsPrompt = function (ctx, limit) {
            var bl          = _this.getBlocklistPromptLine();
            var actorsStr   = ctx.lead_actors && ctx.lead_actors.length ? ctx.lead_actors.join(', ') : 'unknown';
            var writersStr  = ctx.writers     && ctx.writers.length     ? ctx.writers.join(', ')     : '';
            var tasteProfile = _this.getTasteProfileLine();

            return 'You are a world-class film curator.\n\n' +
                (tasteProfile ? tasteProfile + '\n\n' : '') +
                'Film context:\n' +
                '- Title: "' + ctx.title + '" (' + ctx.year + '), ' + ctx.type + '\n' +
                (ctx.director  ? '- Director: ' + ctx.director  + '\n' : '') +
                (writersStr    ? '- Writers: '  + writersStr    + '\n' : '') +
                '- Cast: ' + actorsStr + '\n' +
                (ctx.genres    ? '- Genres: '   + ctx.genres    + '\n' : '') +
                (ctx.countries ? '- Countries: ' + ctx.countries + '\n' : '') +
                (ctx.imdb_id   ? '- IMDb ID: '   + ctx.imdb_id  + ' (use your knowledge of its ratings)\n' : '') +
                (ctx.keywords  ? '- Themes: '    + ctx.keywords  + '\n' : '') +
                (ctx.collection ? '- Collection: ' + ctx.collection + '\n' : '') +
                (ctx.overview  ? '- Overview: "' + ctx.overview  + '"\n' : '') +
                '\nFind strictly ' + limit + ' films/series with similar EMOTIONAL CORE and THEMATIC DNA.\n\n' +
                'RULES:\n' +
                '1. Prefer lesser-known gems, but do not exclude quality popular films\n' +
                '2. Include films from different countries and eras\n' +
                '3. Never suggest sequels, prequels, remakes of "' + ctx.title + '"\n' +
                '4. Strongly prefer titles with Ukrainian dubbing or subtitles\n' +
                (bl ? '5. ' + bl + '\n' : '') +
                '\nRespond ONLY with valid JSON array, no markdown:\n' +
                '[{"uk":"\u041D\u0430\u0437\u0432\u0430","orig":"Original Title","year":2020,"why":"\u041e\u0434\u043d\u0435 \u0440\u0435\u0447\u0435\u043d\u043d\u044f \u0443\u043a\u0440\u0430\u0457\u043d\u0441\u044c\u043a\u043e\u044e"}]';
        };

        this.buildFactsPrompt = function (ctx) {
            // ВАЖЛИВО: коли Gemini Grounding (google_search) використовується разом
            // з промптом що одразу вимагає "ONLY JSON" — за підтвердженими звітами
            // спільноти розробників (форум Google AI Developers, проєкт GroundCite)
            // grounding_metadata часто повертається ПОРОЖНІМ, бо механізм цитування
            // Gemini прив'язаний до позицій у вільному тексті, а не до полів JSON.
            // Тому спочатку просимо коротке вільнотекстове дослідження (де Grounding
            // реально спрацьовує і модель НЕ ігнорує пошук), а вже потім — стиснути
            // це у фінальний JSON. Це не гарантія, але суттєво підвищує шанс що
            // пошук дійсно використано перед тим як факти "застигнуть" у форматі.
            return 'Ти кінокритик що готує цікаві факти про ' + ctx.type +
                ' "' + ctx.original_title + '" (' + ctx.year + '). Мова: українська.\n\n' +
                'КРОК 1 — Спочатку, якщо потрібно, знайди та згадай подумки реальні перевірені факти ' +
                'про цей фільм/серіал (закулісні історії, натхнення для персонажів, цікаві збіги).\n\n' +
                'КРОК 2 — Сформулюй до 7 фактів які справді здивують глядача. ' +
                'КРИТИЧНО: якщо не впевнений у факті на 100% — НЕ включай його. ' +
                'Краще 3 перевірених факти ніж 7 вигаданих. Ніколи не вигадуй імена, локації, ' +
                'або деталі що звучать правдоподібно, але ти їх насправді не знаєш.\n\n' +
                'Типи фактів що цінуються найбільше:\n' +
                '- Кумедні або драматичні історії зі знімального майданчика\n' +
                '- Реальне натхнення для персонажів чи подій\n' +
                '- Відомі сцени які ледь не вирізали\n' +
                '- Несподіваний зв\'язок з іншими фільмами чи реальними подіями\n' +
                '- Цікавинка про акторів чи режисера що здивує фанатів\n\n' +
                'ЗАБОРОНЕНО: дата виходу, список нагород, цифри бюджету, вигадані імена.\n' +
                'Пиши жваво, із захопленням, ніби розповідаєш другу.\n\n' +
                'Відповідай ЛИШЕ JSON масивом, без жодного тексту до чи після нього:\n' +
                '[{"title":"Коротка яскрава назва","text":"2-3 речення у жвавому стилі"}]';
        };

        this.buildRecapPrompt = function (itemTitle, franchiseTitle, year, overview) {
            // overview з TMDB (якщо є) дається AI як підказка-якір — це сильно зменшує
            // кількість випадків "не знаю сюжету" для менш відомих фільмів і старих частин,
            // бо AI має за що зачепитись замість покладатись лише на власну пам'ять.
            var overviewHint = overview ? '\n\nOfficial synopsis for reference (use this as a base, expand with known details):\n"' + overview + '"\n' : '';

            return 'You are a viewer recapping "' + itemTitle + '" (' + franchiseTitle + ', ' + year + ') for a friend. Language: Ukrainian.' +
                overviewHint + '\n' +
                'CRITICAL RULE: Recap ONLY the REAL plot of this work. Use the official synopsis above if provided.\n' +
                'If you have NEITHER the synopsis above NOR your own knowledge of the plot — return only:\n' +
                '[{"point":"\u041d\u0430 \u0436\u0430\u043b\u044c, \u0434\u0435\u0442\u0430\u043b\u044c\u043d\u0430 \u0456\u043d\u0444\u043e\u0440\u043c\u0430\u0446\u0456\u044f \u043f\u0440\u043e \u0441\u044e\u0436\u0435\u0442 \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u043d\u0430."}]\n' +
                'NEVER invent characters, events, or names that are not supported by the synopsis or your knowledge.\n\n' +
                'Write 10 short points WHAT HAPPENED, expanding the synopsis with plausible detail.\n' +
                'Each point = one real event. Conversational style. No category headers.\n' +
                'FORBIDDEN: headers like "Main plot:", invented events, characters.\n\n' +
                'Respond ONLY with JSON array:\n' +
                '[{"point":"..."}]';
        };

        this.buildTagsPrompt = function (tagOrigName, limit) {
            var bl = _this.getBlocklistPromptLine();
            return 'Suggest strictly ' + limit + ' films/series strongly associated with TMDB keyword: "' + tagOrigName + '".\n' +
                'Include films from different countries and eras.\n' +
                'Prefer titles with Ukrainian dubbing or subtitles.\n' +
                (bl ? bl + '\n' : '') +
                'Respond ONLY with valid JSON array:\n' +
                '[{"uk":"\u041d\u0430\u0437\u0432\u0430","orig":"Original Title","year":2020}]';
        };

        this.detectMoodFromQuery = function (q) {
            var lq    = q.toLowerCase();
            var moods = [];
            var map   = [
                { keys:['\u0441\u0442\u0440\u0430\u0448\u043d','\u0436\u0430\u0445\u043b','\u0445\u043e\u0440\u043e\u0440','\u043b\u044f\u043a\u0430\u0442\u0438'],          mood:'horror, psychological fear, suspense' },
                { keys:['\u0441\u043c\u0456\u0448\u043d','\u043a\u043e\u043c\u0435\u0434\u0456','\u0441\u043c\u0456\u044f\u0442\u0438\u0441\u044c','\u0436\u0430\u0440\u0442'],       mood:'comedy, lighthearted, fun' },
                { keys:['\u043f\u043b\u0430\u043a\u0430\u0442','\u0437\u0432\u043e\u0440\u0443\u0448\u043b','\u0441\u043b\u044c\u043e\u0437\u0438','\u0441\u0443\u043c\u043d'],       mood:'emotional drama, tearjerker, melancholic' },
                { keys:['\u0435\u043a\u0448\u043d','\u0431\u043e\u0439\u043e\u0432','\u0434\u0438\u043d\u0430\u043c\u0456\u0447\u043d','\u043f\u0440\u0438\u0433\u043e\u0434'],      mood:'action-packed, high energy, adventure' },
                { keys:['\u0440\u043e\u043c\u0430\u043d\u0442\u0438\u0447','\u043b\u044e\u0431\u043e\u0432','\u043a\u043e\u0445\u0430\u043d\u043d\u044f'],                     mood:'romance, love story' },
                { keys:['\u0434\u0443\u043c\u0430\u0442\u0438','\u0440\u043e\u0437\u0443\u043c\u043d','\u0441\u043a\u043b\u0430\u0434\u043d','\u0444\u0456\u043b\u043e\u0441\u043e\u0444'],      mood:'thought-provoking, intellectual' },
                { keys:['\u0434\u0456\u0442','\u0441\u0456\u043c\u0435\u0439\u043d','\u043c\u0443\u043b\u044c\u0442\u0444\u0456\u043b\u044c\u043c','\u0430\u043d\u0456\u043c\u0430\u0446'],   mood:'family friendly, animation' },
                { keys:['\u0432\u043e\u0454\u043d','\u0432\u0456\u0439\u0441\u044c\u043a','\u0441\u043e\u043b\u0434\u0430\u0442'],                                     mood:'war drama, military' },
                { keys:['\u043f\u043e\u0445\u043c\u0443\u0440','\u0442\u0435\u043c\u043d','\u0432\u0430\u0436\u043a'],                                             mood:'dark, atmospheric, gritty' },
                { keys:['\u0440\u043e\u0437\u0441\u043b\u0430\u0431','\u043b\u0435\u0433\u043a','\u0444\u043e\u043d\u043e\u0432\u043e'],                                   mood:'easy watching, relaxing, feel-good' },
            ];
            map.forEach(function (entry) {
                if (entry.keys.some(function(k){ return lq.indexOf(k)>-1; })) moods.push(entry.mood);
            });
            return moods.join('; ');
        };

        this.buildSearchPrompt = function (query, limit) {
            var mood        = _this.detectMoodFromQuery(query);
            var lq          = query.toLowerCase();
            var isMovie     = lq.indexOf('\u0444\u0456\u043b\u044c\u043c') > -1;
            var isSeries    = lq.indexOf('\u0441\u0435\u0440\u0456\u0430\u043b') > -1;
            var filter      = isMovie ? 'strictly only movies' : (isSeries ? 'strictly only TV series' : 'movies and TV series');
            var bl          = _this.getBlocklistPromptLine();
            var tasteProfile = _this.getTasteProfileLine();

            return 'Act as a movie expert. Suggest strictly ' + limit + ' ' + filter + ' for query: "' + query + '".\n' +
                (mood        ? 'Required mood/atmosphere: ' + mood + '.\n' : '') +
                (tasteProfile ? tasteProfile + '\n' : '') +
                'Prefer titles with Ukrainian dubbing or subtitles when possible.\n' +
                (bl ? bl + '\n' : '') +
                'Respond ONLY with valid JSON array, no markdown:\n' +
                '[{"uk":"\u041d\u0430\u0437\u0432\u0430","orig":"Original Title","year":2020}]';
        };

        // -------------------------------------------------------------------
        //  processAiList — parallel TMDB search + 12s timeout + client dedup
        // -------------------------------------------------------------------

        // TMDB CDN обмежує максимум 20 одночасних з'єднань з одного IP
        // (підтверджено адміністратором TMDB на офіційному форумі talk.themoviedb.org).
        // При limit=50 старий forEach запускав ДО 50 паралельних запитів одночасно —
        // це перевищувало ліміт і ризикувало масовими 429 помилками від TMDB.
        // Тому обробляємо список батчами по 15 запитів — із запасом нижче ліміту.
        var TMDB_BATCH_SIZE = 15;

        this.processAiList = function (list, callback) {
            if (!window.ai_pagination.exclude_ids) window.ai_pagination.exclude_ids = [];
            if (!list || !list.length) { callback([]); return; }

            var results  = [];
            var finished = false;

            var finish = function () {
                if (finished) return;
                finished = true;
                dbg.log('processAiList: found ' + results.length + ' of ' + list.length);
                callback(results);
            };

            var globalTimeout = setTimeout(function () {
                dbg.log('processAiList: 12s timeout, returning ' + results.length);
                finish();
            }, 12000);

            var processOne = function (item, onDone) {
                var q = ((item.orig || item.uk || '')).trim();
                if (!q) { onDone(); return; }
                Lampa.Network.silent(
                    Lampa.TMDB.api('search/multi?query=' + encodeURIComponent(q) + '&api_key=' + Lampa.TMDB.key() + '&language=uk-UA'),
                    function (res) {
                        // TMDB multi-search може повертати media_type: person АБО collection.
                        // Беремо перший результат що дійсно є movie/tv (з підтвердженого форуму TMDB).
                        var b = null;
                        if (res.results && res.results.length) {
                            b = res.results.find(function (r) { return r.media_type === 'movie' || r.media_type === 'tv'; });
                        }
                        if (b && window.ai_pagination.exclude_ids.indexOf(b.id) === -1) {
                            window.ai_pagination.exclude_ids.push(b.id);
                            b.source = 'tmdb';
                            if (item.why) b.ai_why = item.why;
                            results.push(b);
                        }
                        onDone();
                    },
                    function () { onDone(); }
                );
            };

            var processBatch = function (startIdx) {
                if (finished) return;
                if (startIdx >= list.length) { clearTimeout(globalTimeout); finish(); return; }

                var batch = list.slice(startIdx, startIdx + TMDB_BATCH_SIZE);
                var batchCompleted = 0;

                batch.forEach(function (item) {
                    processOne(item, function () {
                        batchCompleted++;
                        if (batchCompleted === batch.length) {
                            processBatch(startIdx + TMDB_BATCH_SIZE);
                        }
                    });
                });
            };

            processBatch(0);
        };

        // -------------------------------------------------------------------
        //  BLOCKLIST
        // -------------------------------------------------------------------

        this.getBlocklist = function () {
            try {
                var raw = Lampa.Storage.get(SK.blocklist, '');
                return raw ? JSON.parse(raw) : { genres: [], franchises: [] };
            } catch (e) { return { genres: [], franchises: [] }; }
        };

        this.saveBlocklist = function (bl) {
            try { Lampa.Storage.set(SK.blocklist, JSON.stringify(bl)); } catch (e) {}
        };

        this.showBlocklistEditor = function () {
            var bl = _this.getBlocklist();
            var wrapper = $('<div style="margin-bottom:14px;min-height:30px;"></div>');
            var container = $('<div></div>');
            container.append(wrapper);

            var renderList = function () {
                wrapper.empty();
                var items = [];
                (bl.genres     || []).forEach(function(g){ items.push({text:g, type:'genres',     label:'\u0436\u0430\u043d\u0440'}); });
                (bl.franchises || []).forEach(function(f){ items.push({text:f, type:'franchises', label:'\u0444\u0440\u0430\u043d\u0448\u0438\u0437\u0430'}); });
                if (!items.length) {
                    wrapper.append('<div style="opacity:0.5;padding:10px 0;font-size:0.95em;">\u0421\u043f\u0438\u0441\u043e\u043a \u043f\u043e\u0440\u043e\u0436\u043d\u0456\u0439</div>');
                    return;
                }
                items.forEach(function (item) {
                    var row = $('<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.07);">' +
                        '<span style="font-size:0.95em;">' + item.text + ' <span style="opacity:0.4;font-size:0.8em;">(' + item.label + ')</span></span>' +
                        '<div class="bl-del selector" style="padding:5px 12px;border-radius:6px;background:rgba(255,50,50,0.15);font-size:0.85em;">&#10005; \u0412\u0438\u0434\u0430\u043b\u0438\u0442\u0438</div>' +
                        '</div>');
                    row.find('.bl-del').on('hover:enter click', function () {
                        var arr = bl[item.type];
                        var idx = arr.indexOf(item.text);
                        if (idx > -1) arr.splice(idx, 1);
                        _this.saveBlocklist(bl);
                        renderList();
                    });
                    wrapper.append(row);
                });
            };

            var addSection = $('<div style="margin-top:10px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.1);">' +
                '<div style="margin-bottom:8px;font-size:0.9em;opacity:0.6;">\u0414\u043e\u0434\u0430\u0442\u0438 \u043d\u043e\u0432\u0435 \u0432\u0438\u043a\u043b\u044e\u0447\u0435\u043d\u043d\u044f:</div>' +
                '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
                '<div class="bl-genre selector" style="padding:7px 14px;border-radius:8px;background:rgba(255,255,255,0.08);font-size:0.9em;">+ \u0416\u0430\u043d\u0440</div>' +
                '<div class="bl-fr selector" style="padding:7px 14px;border-radius:8px;background:rgba(255,255,255,0.08);font-size:0.9em;">+ \u0424\u0440\u0430\u043d\u0448\u0438\u0437\u0430</div>' +
                '</div></div>');

            var addItem = function (type, label) {
                Lampa.Input.edit({ title: '\u0414\u043e\u0434\u0430\u0442\u0438 ' + label, value: '', free: true }, function (val) {
                    val = (val || '').trim();
                    if (!val) return;
                    if (!bl[type]) bl[type] = [];
                    if (bl[type].indexOf(val) === -1) { bl[type].push(val); _this.saveBlocklist(bl); renderList(); }
                });
            };
            addSection.find('.bl-genre').on('hover:enter click', function(){ addItem('genres','\u0436\u0430\u043d\u0440'); });
            addSection.find('.bl-fr').on('hover:enter click',    function(){ addItem('franchises','\u0444\u0440\u0430\u043d\u0448\u0438\u0437\u0443'); });
            container.append(addSection);
            renderList();

            Lampa.Modal.open({
                title: '\u0411\u043b\u043e\u043a-\u043b\u0438\u0441\u0442', html: container, size: 'small', scroll_to_center: true,
                onBack: function () { Lampa.Modal.close(); Lampa.Controller.toggle('settings_component'); }
            });
        };

        // -------------------------------------------------------------------
        //  SETTINGS
        // -------------------------------------------------------------------

        this.setupSettings = function () {
            Lampa.SettingsApi.addComponent({ component: 'ai_assistant_cfg', name: 'AI \u0410\u0441\u0438\u0441\u0442\u0435\u043d\u0442', icon: PLUGIN_ICON });

            Lampa.SettingsApi.addParam({
                component: 'ai_assistant_cfg',
                param: { name: 'ai_gemini_key_trigger', type: 'trigger' },
                field: { name: 'Gemini API key', description: 'aistudio.google.com/api-keys \u2014 \u043c\u043e\u0436\u043d\u0430 \u043a\u0456\u043b\u044c\u043a\u0430 \u0447\u0435\u0440\u0435\u0437 \u043a\u043e\u043c\u0443' },
                onRender: function (item) {
                    var upd = function () {
                        var v = Lampa.Storage.get(SK.gemini_key, '');
                        item.find('.settings-param__value').text(v ? '\u0422\u0430\u043a' : '\u041d\u0456').css('color', v ? '#4b5' : '#f55');
                    };
                    upd();
                    item.on('hover:enter', function () {
                        Lampa.Input.edit({ title: 'Gemini API key', value: Lampa.Storage.get(SK.gemini_key, ''), free: true }, function (v) {
                            if (v !== undefined) { Lampa.Storage.set(SK.gemini_key, v.trim()); upd(); }
                        });
                    });
                }
            });

            Lampa.SettingsApi.addParam({
                component: 'ai_assistant_cfg',
                param: { name: 'ai_openrouter_key_trigger', type: 'trigger' },
                field: { name: 'OpenRouter API key', description: 'openrouter.ai/keys \u2014 \u0440\u0435\u0437\u0435\u0440\u0432\u043d\u0438\u0439 \u043f\u0440\u043e\u0432\u0430\u0439\u0434\u0435\u0440' },
                onRender: function (item) {
                    var upd = function () {
                        var v = Lampa.Storage.get(SK.openrouter_key, '');
                        item.find('.settings-param__value').text(v ? '\u0422\u0430\u043a' : '\u041d\u0456').css('color', v ? '#4b5' : '#f55');
                    };
                    upd();
                    item.on('hover:enter', function () {
                        Lampa.Input.edit({ title: 'OpenRouter API key', value: Lampa.Storage.get(SK.openrouter_key, ''), free: true }, function (v) {
                            if (v !== undefined) { Lampa.Storage.set(SK.openrouter_key, v.trim()); upd(); }
                        });
                    });
                }
            });

            Lampa.SettingsApi.addParam({
                component: 'ai_assistant_cfg',
                param: {
                    name: SK.provider_mode, type: 'select',
                    values: { 'auto': '\u0410\u0432\u0442\u043e (Gemini \u2192 OpenRouter)', 'gemini_only': '\u0422\u0456\u043b\u044c\u043a\u0438 Gemini', 'openrouter_only': '\u0422\u0456\u043b\u044c\u043a\u0438 OpenRouter' },
                    default: 'auto'
                },
                field: { name: '\u0420\u0435\u0436\u0438\u043c \u043f\u0440\u043e\u0432\u0430\u0439\u0434\u0435\u0440\u0456\u0432' },
                onChange: function () {
                    var infoItem = $('.settings-param[data-name="ai_active_provider_info"]');
                    if (infoItem.length) {
                        infoItem.find('.settings-param__name').text('\u041f\u0440\u043e\u0432\u0430\u0439\u0434\u0435\u0440: ' + _this.getActiveProviderName());
                        infoItem.find('.settings-param__value').hide();
                    }
                }
            });

            Lampa.SettingsApi.addParam({
                component: 'ai_assistant_cfg',
                param: { name: 'ai_active_provider_info', type: 'trigger' },
                field: { name: '\u041f\u0440\u043e\u0432\u0430\u0439\u0434\u0435\u0440', description: '\u041f\u043e\u0442\u043e\u0447\u043d\u0438\u0439 \u0430\u043a\u0442\u0438\u0432\u043d\u0438\u0439 AI \u043f\u0440\u043e\u0432\u0430\u0439\u0434\u0435\u0440' },
                onRender: function (item) {
                    item.attr('data-name', 'ai_active_provider_info');
                    item.find('.settings-param__name').text('\u041f\u0440\u043e\u0432\u0430\u0439\u0434\u0435\u0440: ' + _this.getActiveProviderName());
                    item.find('.settings-param__value').hide();
                    item.css('cursor', 'default').off('hover:enter').off('click');
                }
            });

            Lampa.SettingsApi.addParam({
                component: 'ai_assistant_cfg',
                param: { name: SK.result_count, type: 'select', values: { '10':'10','20':'20','30':'30','50':'50' }, default: '20' },
                field: { name: '\u041a\u0456\u043b\u044c\u043a\u0456\u0441\u0442\u044c \u0440\u0435\u0437\u0443\u043b\u044c\u0442\u0430\u0442\u0456\u0432' }
            });

            Lampa.SettingsApi.addParam({
                component: 'ai_assistant_cfg',
                param: { name: SK.font_size, type: 'select', values: { '1.1em':'1.1em','1.2em':'1.2em','1.3em':'1.3em','1.4em':'1.4em','1.5em':'1.5em','1.6em':'1.6em' }, default: '1.2em' },
                field: { name: '\u0420\u043e\u0437\u043c\u0456\u0440 \u0442\u0435\u043a\u0441\u0442\u0443' }
            });

            Lampa.SettingsApi.addParam({
                component: 'ai_assistant_cfg',
                param: { type: 'button', name: 'ai_blocklist_trigger' },
                field: { name: '\u0411\u043b\u043e\u043a-\u043b\u0438\u0441\u0442', description: '\u0412\u0438\u043a\u043b\u044e\u0447\u0438\u0442\u0438 \u0436\u0430\u043d\u0440\u0438 \u0442\u0430 \u0444\u0440\u0430\u043d\u0448\u0438\u0437\u0438' },
                onChange: function () { _this.showBlocklistEditor(); }
            });

            Lampa.SettingsApi.addParam({
                component: 'ai_assistant_cfg',
                param: { name: SK.debug_mode, type: 'select', values: { 'false':'\u0412\u0438\u043c\u043a\u043d\u0435\u043d\u043e','true':'\u0423\u0432\u0456\u043c\u043a\u043d\u0435\u043d\u043e' }, default: 'false' },
                field: { name: 'Debug \u0440\u0435\u0436\u0438\u043c', description: '\u0422\u0435\u0445\u043d\u0456\u0447\u043d\u0456 \u0434\u0435\u0442\u0430\u043b\u0456 \u0443 \u043a\u043e\u043d\u0441\u043e\u043b\u0456' }
            });
        };

        // -------------------------------------------------------------------
        //  GLOBAL AI SEARCH with mood detection, taste profile, TMDB router
        // -------------------------------------------------------------------

        this.setupGlobalSearch = function () {
            var searchSource = {
                title: 'AI \u041f\u043e\u0448\u0443\u043a',
                search: function (params, done) {
                    var q     = decodeURIComponent(params.query || '').trim();
                    var limit = Lampa.Storage.get(SK.result_count, '20');
                    if (!q) return done([]);

                    var cid    = 'q_' + q.replace(/\W+/g, '_').slice(0, 40);
                    var cached = _this.cacheGet('search', cid);
                    if (cached) { done([{ title: 'AI: ' + q, results: cached, total: cached.length }]); return; }

                    window.ai_active_controller = Lampa.Controller.enabled().name;

                    // Route trending/year queries to TMDB directly
                    var tmdbFn = _this.tryTMDBDiscover(q, limit);
                    if (tmdbFn) {
                        _this.updateStatus('\u041f\u043e\u0448\u0443\u043a \u0443 \u0431\u0430\u0437\u0456 TMDB');
                        tmdbFn(function (results) {
                            _this.hideStatus();
                            if (results.length) _this.cacheSet('search', cid, results);
                            done([{ title: 'TMDB: ' + q, results: results, total: results.length }]);
                        });
                        return;
                    }

                    // Enable Grounding for queries about new/best films
                    var lqCheck = q.toLowerCase();
                    var needsFresh = /\b(202[5-9]|203[0-9])\b/.test(lqCheck) ||
                        ['\u043d\u043e\u0432\u0438\u043d\u043a','\u043d\u043e\u0432\u0456','\u0441\u0432\u0456\u0436','\u043e\u0441\u0442\u0430\u043d\u043d','\u043a\u0440\u0430\u0449','\u0442\u043e\u043f'].some(function(k){ return lqCheck.indexOf(k)>-1; });

                    var p = _this.buildSearchPrompt(q, limit);
                    _this.updateStatus('\u041f\u043e\u0448\u0443\u043a \u0440\u0435\u0437\u0443\u043b\u044c\u0442\u0430\u0442\u0456\u0432');

                    _this.request(p, function (text) {
                        var list      = _this.parseJsonSafe(text);
                        var validated = _this.applyContract(list, 'search');
                        if (!validated || !validated.length) { _this.hideStatus(); done([]); return; }
                        _this.processAiList(validated, function (results) {
                            _this.hideStatus();
                            if (results.length) _this.cacheSet('search', cid, results);
                            done([{ title: 'AI: ' + q, results: results, total: results.length }]);
                        });
                    }, function () { _this.hideStatus(); done([]); }, { useGrounding: needsFresh });
                },
                params: { save: true, lazy: true },
                onSelect: function (p, close) {
                    close();
                    Lampa.Activity.push({ url: p.element.media_type+'/'+p.element.id, component:'full', id:p.element.id, method:p.element.media_type, card:p.element, source:'tmdb' });
                }
            };
            setTimeout(function () {
                var s = Lampa.Search.sources ? Lampa.Search.sources() : [];
                if (s.length >= 2) s.splice(2, 0, searchSource); else Lampa.Search.addSource(searchSource);
            }, 1500);
        };

        // -------------------------------------------------------------------
        //  TAGS — preload and translate
        // -------------------------------------------------------------------

        this.preloadTags = function (card) {
            if (card.translated_tags !== undefined) return;
            card.translated_tags = null;
            setTimeout(function () {
                if (card.translated_tags !== null) return;
                _this.runOwnTagTranslation(card);
            }, 3000);
        };

        this.runOwnTagTranslation = function (card) {
            if (card.translated_tags !== null) return;
            var method = (card.original_name || card.name) ? 'tv' : 'movie';
            $.ajax({
                url: Lampa.TMDB.api(method + '/' + card.id + '/keywords?api_key=' + Lampa.TMDB.key()),
                dataType: 'json',
                success: function (resp) {
                    var tags = resp.keywords || resp.results || [];
                    if (tags.length > 0) _this.translateTags(tags, function(t){ card.translated_tags = t; });
                    else card.translated_tags = [];
                },
                error: function () { card.translated_tags = []; }
            });
        };

        this.translateTags = function (tags, callback) {
            var lang = Lampa.Storage.get('language', 'uk');
            tags.forEach(function(t){ if (!t.orig_name) t.orig_name = t.name; });
            if (lang !== 'uk') return callback(tags);
            $.ajax({
                url: 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=uk&dt=t&q=' +
                    encodeURIComponent(tags.map(function(t){ return 'Movie tag: '+t.name; }).join(' ||| ')),
                dataType: 'json',
                success: function (res) {
                    try {
                        var text = '';
                        if (res && res[0]) res[0].forEach(function(i){ if (i[0]) text += i[0]; });
                        var arr = text.split('|||');
                        tags.forEach(function(tag, idx) {
                            if (arr[idx]) {
                                var cleaned = arr[idx];
                                // Прибираємо ВСІ варіанти префіксу що повертає Google Translate:
                                // "Тег фільму:", "Тег до фільму:", "Позначка фільму:", "Позначка до фільму:", "Movie tag:"
                                cleaned = cleaned.replace(/^\s*(\u043f\u043e\u0437\u043d\u0430\u0447\u043a\u0430|\u0442\u0435\u0433)\s*(\u0434\u043e\s*)?\u0444\u0456\u043b\u044c\u043c\u0443\s*[:\-]?\s*/gi, '');
                                cleaned = cleaned.replace(/^\s*movie\s*tag\s*[:\-]?\s*/gi, '');
                                cleaned = cleaned.replace(/^[:\s\-]+/, '').trim();
                                tag.name = cleaned;
                            }
                        });
                        callback(tags);
                    } catch(e){ callback(tags); }
                },
                error: function(){ callback(tags); }
            });
        };

        // -------------------------------------------------------------------
        //  BUTTON ON CARD
        // -------------------------------------------------------------------

        this.drawButton = function (render, card) {
            var container = render.find('.full-start-new__buttons, .full-start__buttons').first();
            if (!container.length || container.find('.button--ai-assist').length) return;
            var btn = $('<div class="full-start__button selector button--ai-assist">' + PLUGIN_ICON + '<span>AI \u0410\u0441\u0438\u0441\u0442\u0435\u043d\u0442</span></div>');
            btn.on('hover:enter click', function () { _this.openAiMenu(card, btn, render); });
            var lastBtn = container.find('.selector').last();
            if (lastBtn.length) lastBtn.after(btn); else container.append(btn);
        };

        // -------------------------------------------------------------------
        //  MAIN MENU
        // -------------------------------------------------------------------

        this.openAiMenu = function (card, btnElement, renderContainer, prevCtrl) {
            var ctrl  = prevCtrl || Lampa.Controller.enabled().name;
            var items = [
                { title: '\u0420\u0435\u043a\u043e\u043c\u0435\u043d\u0434\u0430\u0446\u0456\u0457', action: 'recommendations' },
                { title: '\u0426\u0456\u043a\u0430\u0432\u0456 \u0444\u0430\u043a\u0442\u0438',  action: 'facts' }
            ];
            if (card.translated_tags && card.translated_tags.length > 0) {
                items.splice(2, 0, { title: '\u0414\u043e\u0431\u0456\u0440\u043a\u0438 \u0437\u0430 \u0442\u0435\u0433\u0430\u043c\u0438', action: 'tags' });
            }
            if ((card.number_of_seasons && card.number_of_seasons > 1) || card.belongs_to_collection) {
                items.push({ title: '\u0421\u0442\u0438\u0441\u043b\u0438\u0439 \u043f\u0435\u0440\u0435\u043a\u0430\u0437', action: 'recap' });
            }
            Lampa.Select.show({
                title: 'AI \u0410\u0441\u0438\u0441\u0442\u0435\u043d\u0442', items: items,
                onSelect: function (item) {
                    setTimeout(function () {
                        if      (item.action === 'recommendations') _this.actionRecommendations(card, btnElement, renderContainer, ctrl);
                        else if (item.action === 'facts')           _this.actionFacts(card, btnElement, renderContainer, ctrl);
                        else if (item.action === 'tags')            _this.actionTags(card, btnElement, renderContainer, ctrl);
                        else if (item.action === 'recap')           _this.actionRecapMenu(card, btnElement, renderContainer, ctrl);
                    }, 50);
                },
                onBack: function () { _this.restoreFocus(btnElement, renderContainer, ctrl); }
            });
        };

        // -------------------------------------------------------------------
        //  ACTION: RECOMMENDATIONS (with sub-menu)
        // -------------------------------------------------------------------

        this.actionRecommendations = function (card, btn, render, ctrl) {
            if (!_this.checkApiKey(btn, render, ctrl)) return;
            var limit = Lampa.Storage.get(SK.result_count, '20');
            window.ai_active_controller = ctrl || Lampa.Controller.enabled().name;

            var recTypes = [
                { title: '\u0421\u0445\u043e\u0436\u0456 \u0437\u0430 \u0430\u0442\u043c\u043e\u0441\u0444\u0435\u0440\u043e\u044e', action: 'similar' },
                { title: '\u041f\u0456\u0434\u0456\u0431\u0440\u0430\u0442\u0438 \u043d\u0430 \u0432\u0435\u0447\u0456\u0440',    action: 'mood' },
            ];
            var taste = _this.buildTasteProfile();
            if (taste && taste.total >= 5) {
                recTypes.push({ title: '\u041d\u0430 \u043e\u0441\u043d\u043e\u0432\u0456 \u043c\u043e\u0457\u0445 \u0432\u043f\u043e\u0434\u043e\u0431\u0430\u043d\u044c (' + taste.total + ')', action: 'taste' });
            }

            Lampa.Select.show({
                title: '\u0422\u0438\u043f \u0440\u0435\u043a\u043e\u043c\u0435\u043d\u0434\u0430\u0446\u0456\u0439',
                items: recTypes,
                onSelect: function (recItem) {
                    setTimeout(function () {
                        if      (recItem.action === 'mood')    _this.actionMoodSelect(card, btn, render, ctrl, limit);
                        else if (recItem.action === 'taste')   _this.actionTasteRecs(card, btn, render, ctrl, limit);
                        else                                   _this.actionSimilarRecs(card, btn, render, ctrl, limit);
                    }, 50);
                },
                onBack: function () { _this.openAiMenu(card, btn, render, ctrl); }
            });
        };

        this.actionSimilarRecs = function (card, btn, render, ctrl, limit) {
            var cached = _this.cacheGet('recommendations', card.id);
            if (cached) {
                window.ai_cached_results = cached.slice();
                window.ai_cached_results.push({ id:'ai_load_more',is_load_more:true,name:'',poster:'https://bodya-elven.github.io/different/icons/more.webp',img:'https://bodya-elven.github.io/different/icons/more.webp' });
                Lampa.Activity.push({ url:'ai_assistant_list',title:'\u0420\u0435\u043a\u043e\u043c\u0435\u043d\u0434\u0430\u0446\u0456\u0457',component:'category_full',source:'ai_assistant_list',page:1 });
                return;
            }
            _this.updateStatus('\u0410\u043d\u0430\u043b\u0456\u0437 \u0444\u0456\u043b\u044c\u043c\u0443');
            _this.buildTMDBContext(card, function (ctx) {
                _this.fetchList(_this.buildRecommendationsPrompt(ctx, limit), '\u0420\u0435\u043a\u043e\u043c\u0435\u043d\u0434\u0430\u0446\u0456\u0457', card, btn, render, ctrl, 'recommendations');
            });
        };

        this.actionMoodSelect = function (card, btn, render, ctrl, limit) {
            var moods = [
                { title: '\u0414\u043b\u044f \u043f\u0456\u0434\u043d\u044f\u0442\u0442\u044f \u043d\u0430\u0441\u0442\u0440\u043e\u044e',      mood: 'uplifting, feel-good, warm, optimistic ending' },
                { title: '\u0429\u043e\u0431 \u043f\u043e\u043f\u043b\u0430\u043a\u0430\u0442\u0438',             mood: 'emotionally devastating, tearjerker, deep drama' },
                { title: '\u0422\u0440\u0438\u043c\u0430\u0454 \u0432 \u043d\u0430\u043f\u0440\u0443\u0437\u0456',     mood: 'edge-of-your-seat tension, unpredictable twists, thriller' },
                { title: '\u0417\u043c\u0443\u0448\u0443\u0454 \u0434\u0443\u043c\u0430\u0442\u0438',           mood: 'mind-bending, philosophical, thought-provoking' },
                { title: '\u041b\u0435\u0433\u043a\u043e \u0456 \u043d\u0435\u043d\u0430\u043f\u0440\u044f\u0436\u043d\u043e',       mood: 'easy watching, relaxing, lighthearted, no stress' },
                { title: '\u0414\u043b\u044f \u043a\u043e\u043c\u043f\u0430\u043d\u0456\u0457',             mood: 'entertaining for groups, fun, crowd-pleasing, energetic' },
            ];
            Lampa.Select.show({
                title: '\u042f\u043a\u0438\u0439 \u043d\u0430\u0441\u0442\u0440\u0456\u0439?', items: moods,
                onSelect: function (moodItem) {
                    var origTitle = card.original_title || card.original_name;
                    var p = 'Act as a film curator. Suggest strictly ' + limit + ' movies or TV series with mood: "' + moodItem.mood + '". ' +
                        'Use "' + origTitle + '" as reference for genre and quality. ' +
                        'Prefer titles with Ukrainian dubbing or subtitles. ' +
                        _this.getBlocklistPromptLine() +
                        ' Respond ONLY with JSON: [{"uk":"\u041d\u0430\u0437\u0432\u0430","orig":"Original Title","year":2020,"why":"\u0447\u043e\u043c\u0443 \u043f\u0456\u0434\u0445\u043e\u0434\u0438\u0442\u044c"}]';
                    _this.fetchList(p, moodItem.title, card, btn, render, ctrl, null);
                },
                onBack: function () { _this.openAiMenu(card, btn, render, ctrl); }
            });
        };

        this.actionTasteRecs = function (card, btn, render, ctrl, limit) {
            var tasteStr  = _this.getTasteProfileLine();
            var origTitle = card.original_title || card.original_name;
            var p = 'Act as a personal film curator. ' + tasteStr + ' ' +
                'Suggest strictly ' + limit + ' movies or TV series the user will love, ' +
                'somewhat related to the theme of "' + origTitle + '". ' +
                'Avoid obvious mainstream choices. Prefer hidden gems. ' +
                'Prefer titles with Ukrainian dubbing or subtitles. ' +
                _this.getBlocklistPromptLine() +
                ' Respond ONLY with JSON: [{"uk":"\u041d\u0430\u0437\u0432\u0430","orig":"Original Title","year":2020,"why":"\u0447\u043e\u043c\u0443 \u0432\u0456\u0434\u043f\u043e\u0432\u0456\u0434\u0430\u0454 \u0441\u043c\u0430\u043a\u0443"}]';
            _this.fetchList(p, '\u041d\u0430 \u043e\u0441\u043d\u043e\u0432\u0456 \u0432\u043f\u043e\u0434\u043e\u0431\u0430\u043d\u044c', card, btn, render, ctrl, null);
        };

        // -------------------------------------------------------------------
        //  ACTION: FACTS
        // -------------------------------------------------------------------

        this.actionFacts = function (card, btn, render, ctrl) {
            if (!_this.checkApiKey(btn, render, ctrl)) return;
            var ukrT = card.title || card.name;
            window.ai_active_controller = ctrl || Lampa.Controller.enabled().name;

            var cached = _this.cacheGet('facts', card.id);
            if (cached) { _this.showViewer('\u0426\u0456\u043a\u0430\u0432\u0456 \u0444\u0430\u043a\u0442\u0438: ' + ukrT, cached, btn, render, ctrl); return; }

            _this.updateStatus('\u0417\u0431\u0456\u0440 \u0444\u0430\u043a\u0442\u0456\u0432');
            var buildAndRequest = function (ctx) {
                _this.request(_this.buildFactsPrompt(ctx), function (text) {
                    _this.hideStatus();
                    if (Lampa.Activity.active() && Lampa.Activity.active().component !== 'full') return;
                    var data      = _this.parseJsonSafe(text);
                    var validated = _this.applyContract(data, 'fact');
                    if (!validated || !validated.length) {
                        Lampa.Noty.show('\u041d\u0435 \u0432\u0434\u0430\u043b\u043e\u0441\u044f \u043e\u0442\u0440\u0438\u043c\u0430\u0442\u0438 \u0444\u0430\u043a\u0442\u0438 \u2014 \u0441\u043f\u0440\u043e\u0431\u0443\u0439\u0442\u0435 \u0449\u0435 \u0440\u0430\u0437');
                        _this.restoreFocus(btn, render, ctrl); return;
                    }
                    var html = validated.map(function (f) {
                        var clean = (f.text || '').replace(/\[\d+(?:,\s*\d+)*\]/g, '').trim();
                        return '<div style="margin-bottom:14px"><span class="ai-fact-title">' + f.title + '</span>' + clean + '</div>';
                    }).join('');
                    _this.cacheSet('facts', card.id, html);
                    _this.showViewer('\u0426\u0456\u043a\u0430\u0432\u0456 \u0444\u0430\u043a\u0442\u0438: ' + ukrT, html, btn, render, ctrl);
                }, function () {
                    _this.hideStatus(); _this.restoreFocus(btn, render, ctrl);
                }, { useGrounding: true, geminiOnly: true });
            };
            if (card._ai_ctx) buildAndRequest(card._ai_ctx);
            else _this.buildTMDBContext(card, buildAndRequest);
        };

        // -------------------------------------------------------------------
        //  ACTION: TAGS
        // -------------------------------------------------------------------

        this.actionTags = function (card, btn, render, ctrl) {
            if (!_this.checkApiKey(btn, render, ctrl)) return;
            if (card.translated_tags && card.translated_tags.length > 0) _this.showTagsMenu(card.translated_tags, card, btn, render, ctrl);
            else _this.restoreFocus(btn, render, ctrl);
        };

        this.showTagsMenu = function (tags, card, btn, render, ctrl) {
            // TMDB keywords часто містять службові/оціночні мітки що не мають сенсу
            // як категорія для пошуку схожих фільмів (наприклад "нудний", "переоцінений",
            // або занадто загальні типу "сюжет", "персонаж"). Відфільтровуємо їх.
            var BLOCKED_TAG_WORDS = [
                '\u043d\u0443\u0434\u043d', '\u043f\u0435\u0440\u0435\u043e\u0446\u0456\u043d', '\u043f\u043e\u0433\u0430\u043d',
                'boring', 'overrated', 'bad', 'worst',
                '\u0441\u044e\u0436\u0435\u0442', '\u043f\u0435\u0440\u0441\u043e\u043d\u0430\u0436', 'plot', 'character'
            ];
            var items = tags
                .filter(function(tag){
                    if (!tag.name || tag.name.trim().length === 0) return false;
                    var lower = tag.name.toLowerCase();
                    // Прибираємо занадто короткі (1 символ) та явно оціночні/службові теги
                    if (tag.name.trim().length < 2) return false;
                    return !BLOCKED_TAG_WORDS.some(function(w){ return lower.indexOf(w) > -1; });
                })
                .map(function(tag){ return { title: tag.name.charAt(0).toUpperCase()+tag.name.slice(1), tag_data: tag }; });

            if (!items.length) {
                Lampa.Noty.show('\u041d\u0435\u043c\u0430\u0454 \u0432\u0434\u0430\u043b\u0438\u0445 \u0442\u0435\u0433\u0456\u0432 \u0434\u043b\u044f \u0446\u044c\u043e\u0433\u043e \u0444\u0456\u043b\u044c\u043c\u0443');
                _this.restoreFocus(btn, render, ctrl);
                return;
            }
            Lampa.Select.show({
                title: '\u041e\u0431\u0435\u0440\u0456\u0442\u044c \u0442\u0435\u0433', items: items,
                onSelect: function (item) {
                    var limit = Lampa.Storage.get(SK.result_count, '20');
                    _this.fetchList(_this.buildTagsPrompt(item.tag_data.orig_name, limit), '\u0422\u0435\u0433: ' + item.title, card, btn, render, ctrl, null);
                },
                onBack: function () { _this.openAiMenu(card, btn, render, ctrl); }
            });
        };

        this.actionRecapMenu = function (card, btn, render, ctrl) {
            if (!_this.checkApiKey(btn, render, ctrl)) return;
            var items = [];
            if (card.number_of_seasons > 1) {
                // Для сезонів використовуємо поточну картку (серіал один, сезони різні).
                // ВИПРАВЛЕНО: цикл "i < card.number_of_seasons" пропускав ОСТАННІЙ сезон
                // (off-by-one помилка). Наприклад при number_of_seasons=2 цикл давав лише
                // Сезон 1, а Сезон 2 (останній і часто найактуальніший) зникав з меню.
                // TMDB рахує сезони з 1, тому межа має бути <=, не <.
                for (var i = 1; i <= card.number_of_seasons; i++) {
                    items.push({
                        title: '\u0421\u0435\u0437\u043e\u043d ' + i, type: 'season', value: i,
                        orig_title: card.original_title || card.original_name,
                        year: (card.release_date || card.first_air_date || '').slice(0,4),
                        season_number: i
                    });
                }
                _this.showRecapSelect(items, card, btn, render, ctrl);
            } else if (card.belongs_to_collection) {
                window.ai_active_controller = ctrl || Lampa.Controller.enabled().name;
                _this.updateStatus('\u0417\u0431\u0456\u0440 \u043a\u043e\u043b\u0435\u043a\u0446\u0456\u0457');
                Lampa.Network.silent(
                    Lampa.TMDB.api('collection/' + card.belongs_to_collection.id + '?api_key=' + Lampa.TMDB.key() + '&language=uk-UA'),
                    function (res) {
                        _this.hideStatus();
                        // Сортуємо за роком виходу: фільми БЕЗ дати (ще не вийшли) йдуть в кінець,
                        // а не плутаються через рядок '9999' (який міг сортуватись неправильно
                        // відносно реальних майбутніх дат типу '2027-01-01')
                        var parts = (res.parts || []).slice().sort(function(a,b){
                            var da = a.release_date || '', db = b.release_date || '';
                            if (!da && !db) return 0;
                            if (!da) return 1;  // без дати — в кінець
                            if (!db) return -1;
                            return da.localeCompare(db);
                        });
                        // ВАЖЛИВО: показуємо ВСІ частини колекції, ВКЛЮЧНО з поточною відкритою.
                        // Раніше тут був фільтр if (p.id != card.id) — він ховав поточний фільм
                        // з меню переказу, через що список виглядав неповним і "непослідовним".
                        parts.forEach(function(p){
                            var isCurrent = (p.id == card.id);
                            items.push({
                                title: p.title + (isCurrent ? ' \u2605' : ''), // позначка ★ на поточному фільмі
                                type: 'movie',
                                value: p.original_title,
                                orig_title: p.original_title || p.title,
                                year: (p.release_date || '').slice(0,4),
                                tmdb_id: p.id,
                                overview: p.overview || ''
                            });
                        });
                        _this.showRecapSelect(items, card, btn, render, ctrl);
                    },
                    function () {
                        _this.hideStatus();
                        Lampa.Noty.show('\u041f\u043e\u043c\u0438\u043b\u043a\u0430 \u0437\u0430\u0432\u0430\u043d\u0442\u0430\u0436\u0435\u043d\u043d\u044f \u043a\u043e\u043b\u0435\u043a\u0446\u0456\u0457');
                        if (window.ai_active_controller) Lampa.Controller.toggle(window.ai_active_controller);
                    }
                );
            }
        };

        this.showRecapSelect = function (items, card, btn, render, ctrl) {
            Lampa.Select.show({
                title: '\u0429\u043e \u043f\u0435\u0440\u0435\u043a\u0430\u0437\u0430\u0442\u0438?', items: items,
                onSelect: function (item) {
                    // Важливо: беремо назву/рік САМЕ обраної частини (item),
                    // а не поточної відкритої картки (card).
                    // Без цього при переказі сикквелу бралася назва іншої частини.
                    var franchiseTitle = item.orig_title || card.original_title || card.original_name;
                    var year = item.year || (card.release_date || card.first_air_date || '').slice(0, 4);
                    var cid  = card.id + '_' + item.title.replace(/\W/g, '_');
                    var cached = _this.cacheGet('recap', cid);
                    if (cached) { _this.showViewer('\u041f\u0435\u0440\u0435\u043a\u0430\u0437: ' + item.title, cached, btn, render, ctrl); return; }

                    window.ai_active_controller = Lampa.Controller.enabled().name;
                    _this.updateStatus('\u041f\u0456\u0434\u0433\u043e\u0442\u043e\u0432\u043a\u0430 \u043f\u0435\u0440\u0435\u043a\u0430\u0437\u0443');

                    // Overview з TMDB діє як "якір" для AI — суттєво зменшує кількість
                    // випадків "не знаю сюжету" для менш популярних фільмів/сезонів
                    var proceedWithRecap = function (overviewHint) {
                        _this.request(_this.buildRecapPrompt(item.title, franchiseTitle, year, overviewHint), function (text) {
                            _this.hideStatus();
                            if (Lampa.Activity.active().component !== 'full') return;
                            var data      = _this.parseJsonSafe(text);
                            var validated = _this.applyContract(data, 'recap');
                            if (!validated || !validated.length) {
                                Lampa.Noty.show('\u041f\u043e\u043c\u0438\u043b\u043a\u0430 \u043e\u0431\u0440\u043e\u0431\u043a\u0438 \u2014 \u0441\u043f\u0440\u043e\u0431\u0443\u0439\u0442\u0435 \u0449\u0435 \u0440\u0430\u0437');
                                if (window.ai_active_controller) Lampa.Controller.toggle(window.ai_active_controller); return;
                            }
                            var html = validated.map(function(i){ return '<div style="margin-bottom:10px">\u2022 ' + i.point + '</div>'; }).join('');
                            _this.cacheSet('recap', cid, html);
                            _this.showViewer('\u041f\u0435\u0440\u0435\u043a\u0430\u0437: ' + item.title, html, btn, render, ctrl);
                        }, function () {
                            _this.hideStatus();
                            if (window.ai_active_controller) Lampa.Controller.toggle(window.ai_active_controller);
                        }, { geminiOnly: true });
                    };

                    if (item.type === 'movie' && item.overview) {
                        // Overview частини колекції вже завантажений разом зі списком
                        proceedWithRecap(item.overview);
                    } else if (item.type === 'season' && item.season_number) {
                        // Підвантажуємо overview конкретного сезону окремим легким запитом
                        var seasonUrl = Lampa.TMDB.api('tv/' + card.id + '/season/' + item.season_number + '?api_key=' + Lampa.TMDB.key() + '&language=en-US');
                        Lampa.Network.silent(seasonUrl, function (seasonRes) {
                            proceedWithRecap(seasonRes.overview || '');
                        }, function () {
                            proceedWithRecap('');
                        });
                    } else {
                        proceedWithRecap('');
                    }
                },
                onBack: function () { _this.openAiMenu(card, btn, render, ctrl); }
            });
        };

        // -------------------------------------------------------------------
        //  PAGINATION
        // -------------------------------------------------------------------

        this.fetchList = function (base_prompt, title, card, btn, render, ctrl, cacheAction) {
            window.ai_pagination = { base_prompt:base_prompt, exclude_list:[], exclude_ids:[], preloaded_results:null, preloaded_raw_list:null, is_loading:false, is_preloading:false };
            window.ai_cached_results    = [];
            window.ai_active_controller = ctrl || Lampa.Controller.enabled().name;

            var full_prompt = base_prompt + '\nRespond ONLY with valid JSON array. No markdown.';
            _this.updateStatus('\u041f\u0456\u0434\u0431\u0456\u0440 \u0440\u0435\u0437\u0443\u043b\u044c\u0442\u0430\u0442\u0456\u0432');
            _this.request(full_prompt, function (text) {
                var list      = _this.parseJsonSafe(text);
                var validated = _this.applyContract(list, 'recommendation');
                if (Lampa.Activity.active() && Lampa.Activity.active().component !== 'full') { _this.hideStatus(); return; }
                if (!validated || !validated.length) {
                    _this.hideStatus(); Lampa.Noty.show('\u041d\u0456\u0447\u043e\u0433\u043e \u043d\u0435 \u0437\u043d\u0430\u0439\u0434\u0435\u043d\u043e');
                    if (window.ai_active_controller) Lampa.Controller.toggle(window.ai_active_controller); return;
                }
                validated.forEach(function(i){ window.ai_pagination.exclude_list.push(i.orig||i.uk); });
                _this.processAiList(validated, function (results) {
                    _this.hideStatus();
                    if (Lampa.Activity.active() && Lampa.Activity.active().component !== 'full') return;
                    if (!results.length) {
                        Lampa.Noty.show('\u041d\u0456\u0447\u043e\u0433\u043e \u043d\u0435 \u0437\u043d\u0430\u0439\u0434\u0435\u043d\u043e \u0432 TMDB');
                        if (window.ai_active_controller) Lampa.Controller.toggle(window.ai_active_controller); return;
                    }
                    if (cacheAction && card && card.id) _this.cacheSet(cacheAction, card.id, results);
                    window.ai_cached_results = results.slice();
                    window.ai_cached_results.push({ id:'ai_load_more',is_load_more:true,name:'',poster:'https://bodya-elven.github.io/different/icons/more.webp',img:'https://bodya-elven.github.io/different/icons/more.webp' });
                    Lampa.Activity.push({ url:'ai_assistant_list',title:title,component:'category_full',source:'ai_assistant_list',page:1 });
                    setTimeout(function(){ _this.preloadNextPage(); }, 1000);
                });
            }, function () {
                _this.hideStatus(); Lampa.Noty.show('\u041f\u043e\u043c\u0438\u043b\u043a\u0430 \u0437\u2019\u0454\u0434\u043d\u0430\u043d\u043d\u044f \u0437 AI');
                if (window.ai_active_controller) Lampa.Controller.toggle(window.ai_active_controller);
            });
        };

        this.fetchNextPageData = function (callback, isSilent) {
            var limit = Lampa.Storage.get(SK.result_count, '20');
            var exclusions = window.ai_pagination.exclude_list.slice(-50).join(', ');
            var p = window.ai_pagination.base_prompt +
                '\nExclude already shown: ' + exclusions +
                '\nSuggest strictly ' + limit + ' NEW ones.\nRespond ONLY with valid JSON array.';
            _this.request(p, function(text){
                var list = _this.parseJsonSafe(text);
                var validated = _this.applyContract(list, 'recommendation');
                if (!validated || !validated.length) { callback(null,null); return; }
                _this.processAiList(validated, function(results){ callback(validated, results); });
            }, function(){ callback(null,null); }, { isSilent: !!isSilent });
        };

        this.preloadNextPage = function () {
            if (window.ai_pagination.is_preloading) return;
            window.ai_pagination.is_preloading = true;
            _this.fetchNextPageData(function(list, results){
                if (results && results.length) { window.ai_pagination.preloaded_results=results; window.ai_pagination.preloaded_raw_list=list; }
                window.ai_pagination.is_preloading = false;
            }, true);
        };

        this.loadMore = function (activeActivity) {
            if (window.ai_pagination.is_loading) return;
            window.ai_active_controller = Lampa.Controller.enabled().name;

            var renderResults = function (results, rawList) {
                rawList.forEach(function(i){ window.ai_pagination.exclude_list.push(i.orig||i.uk); });
                window.ai_pagination.preloaded_results = null;
                window.ai_pagination.preloaded_raw_list = null;
                window.ai_pagination.is_loading = false;
                _this.hideStatus();
                if (!results.length) { Lampa.Noty.show('\u0411\u0456\u043b\u044c\u0448\u0435 \u043d\u0456\u0447\u043e\u0433\u043e \u043d\u0435 \u0437\u043d\u0430\u0439\u0434\u0435\u043d\u043e'); if (window.ai_active_controller) Lampa.Controller.toggle(window.ai_active_controller); return; }
                window.ai_cached_results = window.ai_cached_results.filter(function(r){ return !r.is_load_more; });
                window.ai_cached_results = window.ai_cached_results.concat(results);
                window.ai_cached_results.push({ id:'ai_load_more',is_load_more:true,name:'',poster:'https://bodya-elven.github.io/different/icons/more.webp',img:'https://bodya-elven.github.io/different/icons/more.webp' });
                if (activeActivity && activeActivity.activity) {
                    var act=activeActivity.activity, rnder=act.render();
                    rnder.find('.item[data-id="ai_load_more"]').remove();
                    var toAppend = results.slice();
                    toAppend.push({ id:'ai_load_more',is_load_more:true,name:'',poster:'https://bodya-elven.github.io/different/icons/more.webp',img:'https://bodya-elven.github.io/different/icons/more.webp' });
                    if (act.append) {
                        act.append(toAppend);
                        if (results[0] && results[0].id) {
                            setTimeout(function(){ var cf=rnder.find('.item[data-id="'+results[0].id+'"]'); if (cf.length) Lampa.Controller.collectionFocus(cf[0],rnder[0]); }, 100);
                        }
                    } else { Lampa.Activity.replace({ url:'ai_assistant_list',title:activeActivity.title,component:'category_full',source:'ai_assistant_list',page:1 }); }
                }
                setTimeout(function(){ _this.preloadNextPage(); }, 1000);
            };

            if (window.ai_pagination.preloaded_results) {
                window.ai_pagination.is_loading = true;
                renderResults(window.ai_pagination.preloaded_results, window.ai_pagination.preloaded_raw_list);
            } else if (window.ai_pagination.is_preloading) {
                window.ai_pagination.is_loading = true;
                _this.updateStatus('\u041f\u0456\u0434\u0431\u0456\u0440 \u0440\u0435\u0437\u0443\u043b\u044c\u0442\u0430\u0442\u0456\u0432...');
                var wi = setInterval(function(){
                    if (window.ai_pagination.preloaded_results) { clearInterval(wi); renderResults(window.ai_pagination.preloaded_results, window.ai_pagination.preloaded_raw_list); }
                    else if (!window.ai_pagination.is_preloading) { clearInterval(wi); window.ai_pagination.is_loading=false; _this.hideStatus(); Lampa.Noty.show('\u041f\u043e\u043c\u0438\u043b\u043a\u0430 \u043f\u0456\u0434\u0431\u043e\u0440\u0443'); if (window.ai_active_controller) Lampa.Controller.toggle(window.ai_active_controller); }
                }, 500);
            } else {
                window.ai_pagination.is_loading = true;
                _this.updateStatus('\u041f\u0456\u0434\u0431\u0456\u0440 \u0440\u0435\u0437\u0443\u043b\u044c\u0442\u0430\u0442\u0456\u0432...');
                _this.fetchNextPageData(function(list,results){
                    if (results && results.length) renderResults(results, list);
                    else { window.ai_pagination.is_loading=false; _this.hideStatus(); Lampa.Noty.show('\u041d\u0456\u0447\u043e\u0433\u043e \u043d\u0435 \u0437\u043d\u0430\u0439\u0434\u0435\u043d\u043e'); if (window.ai_active_controller) Lampa.Controller.toggle(window.ai_active_controller); }
                }, false);
            }
        };

        // -------------------------------------------------------------------
        //  UI HELPERS
        // -------------------------------------------------------------------

        this.getSafeDynamicColor = function () {
            var raw = getComputedStyle(document.documentElement).getPropertyValue('--main-color').trim();
            if (!raw) return '#ffffff';
            var r=0,g=0,b=0;
            if (raw.indexOf('#')===0) { var hex=raw.slice(1); if(hex.length===3)hex=hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2]; r=parseInt(hex.slice(0,2),16);g=parseInt(hex.slice(2,4),16);b=parseInt(hex.slice(4,6),16); }
            else if (raw.indexOf('rgb')===0) { var m=raw.match(/\d+/g); if(m){r=parseInt(m[0]);g=parseInt(m[1]);b=parseInt(m[2]);} }
            else { return raw; }
            r/=255;g/=255;b/=255;
            var max=Math.max(r,g,b),min=Math.min(r,g,b),h=0,s=0,l=(max+min)/2;
            if(max!==min){var d=max-min;s=l>0.5?d/(2-max-min):d/(max+min);switch(max){case r:h=(g-b)/d+(g<b?6:0);break;case g:h=(b-r)/d+2;break;case b:h=(r-g)/d+4;break;}h/=6;}
            if(l<0.35)l=0.35;
            return 'hsl('+Math.round(h*360)+','+Math.round(s*100)+'%,'+Math.round(l*100)+'%)';
        };

        this.showViewer = function (title, contentHtml, btnElement, renderContainer, controllerName) {
            var safeColor = _this.getSafeDynamicColor();
            var fontSize  = Lampa.Storage.get(SK.font_size, '1.2em');
            var viewer = $('<div class="ai-viewer-container" style="--safe-text-color:' + safeColor + ';--ai-font-size:' + fontSize + ';">' +
                '<div class="ai-viewer-body">' +
                '<div class="ai-header"><div class="ai-title">' + title + '</div><div class="ai-close-btn selector">\xD7</div></div>' +
                '<div class="ai-content-scroll">' + contentHtml + '</div>' +
                '</div></div>');
            $('body').append(viewer);
            var close = function(){ viewer.remove(); _this.restoreFocus(btnElement, renderContainer, controllerName); };
            viewer.find('.ai-close-btn').on('click hover:enter', close);
            Lampa.Controller.add('ai_viewer', {
                toggle: function(){ Lampa.Controller.collectionSet(viewer); Lampa.Controller.collectionFocus(viewer.find('.ai-close-btn')[0], viewer); },
                up:   function(){ viewer.find('.ai-content-scroll').scrollTop(viewer.find('.ai-content-scroll').scrollTop()-100); },
                down: function(){ viewer.find('.ai-content-scroll').scrollTop(viewer.find('.ai-content-scroll').scrollTop()+100); },
                back: close
            });
            Lampa.Controller.toggle('ai_viewer');
        };

        this.updateStatus = function (text) {
            if (!statusBox) {
                $('body').append('<div id="ai-assist-status"><div class="ai-toast"><div class="ai-spinner"></div><span class="status-text"></span></div></div>');
                statusBox = $('#ai-assist-status');
            }
            statusBox.find('.status-text').text(text);
            statusBox.fadeIn(200);
        };

        this.hideStatus = function () { if (statusBox) statusBox.fadeOut(500); };

        this.checkApiKey = function (btn, render, ctrl) {
            var ok = !!Lampa.Storage.get(SK.gemini_key,'') || !!Lampa.Storage.get(SK.openrouter_key,'');
            if (!ok) { Lampa.Noty.show('\u0428\u0406 \u0441\u043f\u0438\u0442\u044c \uD83D\uDE34 \u0414\u043e\u0434\u0430\u0439\u0442\u0435 API \u043a\u043b\u044e\u0447 \u0443 \u043d\u0430\u043b\u0430\u0448\u0442\u0443\u0432\u0430\u043d\u043d\u044f\u0445'); if (btn&&render) _this.restoreFocus(btn,render,ctrl); }
            return ok;
        };

        this.restoreFocus = function (btnElement, renderContainer, controllerName) {
            if (Lampa.Activity.active() && Lampa.Activity.active().activity) Lampa.Activity.active().activity.toggle();
            else Lampa.Controller.toggle(controllerName || 'full');
            if (!Lampa.Platform.is('touch') && btnElement && renderContainer) {
                setTimeout(function(){ Lampa.Controller.collectionFocus(btnElement[0], renderContainer[0]); }, 10);
            }
        };

        this.injectStyles = function () {
            if ($('#ai-assistant-styles').length) return;
            $('<style id="ai-assistant-styles">').prop('type','text/css').html(
                '.button--ai-assist{display:flex!important;align-items:center;justify-content:center;gap:1px;}' +
                '.button--ai-assist svg{width:1.9em!important;height:1.9em!important;margin:0!important;}' +
                '#ai-assist-status{position:fixed;bottom:80px;left:0;right:0;text-align:center;z-index:10001;pointer-events:none;display:flex;justify-content:center;}' +
                '.ai-toast{display:inline-flex;align-items:center;gap:12px;background:rgba(0,0,0,0.2);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);padding:10px 24px;border-radius:50px;color:#fff;font-size:1.1em;position:relative;overflow:hidden;height:44px;}' +
                '.ai-toast:after{content:"";position:absolute;top:0;left:-100%;width:30%;height:100%;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.06),transparent);animation:ai-shimmer 4s infinite;}' +
                '@keyframes ai-shimmer{to{left:150%}}' +
                '.ai-spinner{width:22px;height:22px;border-radius:50%;border:3px solid transparent;border-top-color:#fff;animation:ai-rot 0.8s linear infinite,ai-rainbow 4s linear infinite;}' +
                '@keyframes ai-rot{to{transform:rotate(360deg)}}' +
                '@keyframes ai-rainbow{0%{border-top-color:#fff}16.6%{border-top-color:var(--main-color,#fff)}33.3%{border-top-color:#0cf}50%{border-top-color:#f0f}66.6%{border-top-color:var(--main-color,#f0f)}83.3%{border-top-color:#8b0000}100%{border-top-color:#fff}}' +
                '.ai-viewer-container{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);z-index:5001;display:flex;align-items:center;justify-content:center;}' +
                '.ai-viewer-body{width:85%;max-width:900px;height:80%;background:#121212;display:flex;flex-direction:column;border-radius:16px;border:1px solid var(--main-color,#fff);overflow:hidden;}' +
                '.ai-header{height:48px;padding:0 15px;background:#1a1a1a;border-bottom:1px solid #333;display:flex;justify-content:space-between;align-items:center;}' +
                '.ai-title{font-size:1.5em;font-weight:bold;}' +
                '.ai-close-btn{width:32px;height:32px;background:#333;color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:24px;font-family:sans-serif;cursor:pointer;border:2px solid transparent;line-height:0;}' +
                '.ai-close-btn.focus{background:#fff;color:#000;}' +
                '.ai-content-scroll{flex:1;overflow-y:auto;padding:10px 20px 20px 20px;color:#efefef;line-height:1.4;font-size:var(--ai-font-size,1.2em);}' +
                '.ai-fact-title{color:var(--safe-text-color,var(--main-color,#fff));font-weight:bold;display:block;margin-bottom:4px;}'
            ).appendTo('head');
        };
    }

    // -------------------------------------------------------------------
    //  MANIFEST & LAUNCH
    // -------------------------------------------------------------------

    var pluginManifest = {
        type:'other', version: PLUGIN_VERSION,
        name:'AI \u0410\u0441\u0438\u0441\u0442\u0435\u043d\u0442',
        description:'\u0412\u0430\u0448 \u043f\u0435\u0440\u0441\u043e\u043d\u0430\u043b\u044c\u043d\u0438\u0439 \u0428\u0406 \u043f\u043e\u043c\u0456\u0447\u043d\u0438\u043a',
        author:'@bodya_elven', icon: PLUGIN_ICON
    };

    if (Lampa.Manifest && Lampa.Manifest.plugins) Lampa.Manifest.plugins.ai_assistant = pluginManifest;

    if (!window.plugin_ai_assistant_instance) {
        window.plugin_ai_assistant_instance = new AIAssistantPlugin();
        if (window.appready) window.plugin_ai_assistant_instance.init();
        else Lampa.Listener.follow('app', function(e){ if (e.type==='ready') window.plugin_ai_assistant_instance.init(); });
    }

})();
