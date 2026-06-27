(function () {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════
    //  AI АСИСТЕНТ v5.0 для Lampa
    //  Автор оригіналу: @bodya_elven
    //  Архітектура v5.0: МіФ + Claude (Anthropic)
    //  Мова повідомлень: українська
    // ═══════════════════════════════════════════════════════════════════

    var PLUGIN_VERSION = '5.0';

    var PLUGIN_ICON = '<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><style>.cls-left{fill:currentColor;fill-rule:evenodd;}.cls-right{fill:#a0a0a0;fill-rule:evenodd;}</style><g><polygon class="cls-right" points="16.64 15.13 17.38 13.88 20.91 13.88 22 12 19.82 8.25 16.75 8.25 15.69 6.39 14.5 6.39 14.5 5.13 16.44 5.13 17.5 7 19.09 7 16.9 3.25 12.63 3.25 12.63 8.25 14.36 8.25 15.09 9.5 12.63 9.5 12.63 12 14.89 12 15.94 10.13 18.75 10.13 19.47 11.38 16.67 11.38 15.62 13.25 12.63 13.25 12.63 17.63 16.03 17.63 15.31 18.88 12.63 18.88 12.63 20.75 16.9 20.75 20.18 15.13 18.09 15.13 17.36 16.38 14.5 16.38 14.5 15.13 16.64 15.13"/><polygon class="cls-left" points="7.36 15.13 6.62 13.88 3.09 13.88 2 12 4.18 8.25 7.25 8.25 8.31 6.39 9.5 6.39 9.5 5.13 7.56 5.13 6.5 7 4.91 7 7.1 3.25 11.38 3.25 11.38 8.25 9.64 8.25 8.91 9.5 11.38 9.5 11.38 12 9.11 12 8.06 10.13 5.25 10.13 4.53 11.38 7.33 11.38 8.38 13.25 11.38 13.25 11.38 17.63 7.97 17.63 8.69 18.88 11.38 18.88 11.38 20.75 7.1 20.75 3.82 15.13 5.91 15.13 6.64 16.38 9.5 16.38 9.5 15.13 7.36 15.13"/></g></svg>';

    // Gemini: від найсильнішої до найслабшої
    // УВАГА: gemini-3.1-flash-lite-preview відключено Google з 25.05.2026
    var GEMINI_MODELS = [
        'gemini-2.5-flash',
        'gemini-3-flash-preview',
        'gemini-2.5-flash-lite',
        'gemini-3.1-flash-lite',
    ];

    // OpenRouter: від найсильнішої до найслабшої для кіно-задач
    // Оновлюйте ТІЛЬКИ тут при змінах моделей
    var OPENROUTER_MODELS = [
        'google/gemma-4-31b-it:free',
        'openai/gpt-oss-120b:free',
        'meta-llama/llama-4-maverick:free',
        'meta-llama/llama-4-scout:free',
        'openai/gpt-oss-20b:free',
        'deepseek/deepseek-r1:free',
    ];

    // TTL кешу в мілісекундах
    var CACHE_TTL = {
        facts:           7 * 864e5,
        recommendations: 3 * 864e5,
        tags:           14 * 864e5,
        recap:           7 * 864e5,
        search:          1 * 864e5,
    };

    // TTL відновлення провайдерів після вичерпання лімітів
    var PROVIDER_TTL = {
        gemini:     24 * 36e5,
        openrouter: 20 * 6e4,
    };

    // Ключі Lampa.Storage
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

    // Схеми валідації — биті записи відкидаються автоматично
    var SCHEMAS = {
        recommendation: { uk: 'string', orig: 'string', year: 'number' },
        fact:           { title: 'string', text: 'string' },
        recap:          { point: 'string' },
        search:         { uk: 'string', orig: 'string', year: 'number' },
    };

    // Debug логер — вмикається в налаштуваннях, не впливає на користувача
    var dbg = {
        log: function () {
            try {
                if (!Lampa.Storage.get(SK.debug_mode, false)) return;
                var a = Array.prototype.slice.call(arguments);
                a.unshift('[AI v5.0]');
                console.log.apply(console, a);
            } catch (e) {}
        }
    };

    // ───────────────────────────────────────────────────────────────────
    //  ГЛОБАЛЬНИЙ СТАН
    // ───────────────────────────────────────────────────────────────────

    window.ai_pagination = {
        base_prompt: '', exclude_list: [], exclude_ids: [],
        preloaded_results: null, preloaded_raw_list: null,
        is_loading: false, is_preloading: false
    };
    window.ai_cached_results  = [];
    window.ai_active_controller = null;

    // Патч push — перехоплення кнопки "Завантажити ще"
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

    // Кастомне джерело списку результатів
    if (window.Lampa && Lampa.Api) {
        Lampa.Api.sources.ai_assistant_list = {
            list: function (params, oncomplite) {
                oncomplite({ results: window.ai_cached_results, total_pages: 1 });
            }
        };
    }

    // ═══════════════════════════════════════════════════════════════════
    //  ГОЛОВНИЙ КЛАС
    // ═══════════════════════════════════════════════════════════════════

    function AIAssistantPlugin() {
        var _this = this;
        var statusBox = null;

        this.init = function () {
            _this.checkProviderRecovery();
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

        // ───────────────────────────────────────────────────────────────
        //  JSON REPAIR LAYER — пріоритет #1
        //  Три рівні + витяг масиву з об'єкта (для OpenRouter)
        // ───────────────────────────────────────────────────────────────

        this.parseJsonSafe = function (text) {
            if (!text || typeof text !== 'string') return null;

            // Рівень 1: прямий парсинг
            try { var r = JSON.parse(text); if (r) { dbg.log('JSON: прямий ✓'); return r; } } catch (e) {}

            // Рівень 2a: greedy витяг масиву [ ... ]
            // Greedy (не lazy!) — lazy зупинився б на першому ']' всередині масиву
            var mArr = text.match(/\[[\s\S]*\]/);
            if (mArr) {
                try {
                    var r2 = JSON.parse(mArr[0]);
                    if (Array.isArray(r2) && r2.length > 0) { dbg.log('JSON: масив regex ✓'); return r2; }
                } catch (e) {}
            }

            // Рівень 2b: витяг об'єкта { ... } і пошук масиву в полях
            // OpenRouter може повернути { "results": [...] } або { "movies": [...] }
            var mObj = text.match(/\{[\s\S]*\}/);
            if (mObj) {
                try {
                    var obj = JSON.parse(mObj[0]);
                    var keys = Object.keys(obj);
                    for (var i = 0; i < keys.length; i++) {
                        if (Array.isArray(obj[keys[i]]) && obj[keys[i]].length > 0) {
                            dbg.log('JSON: масив у полі "' + keys[i] + '" ✓');
                            return obj[keys[i]];
                        }
                    }
                } catch (e) {}
            }

            // Рівень 3: чистка Markdown і повторна спроба
            var clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
            try { var r3 = JSON.parse(clean); if (r3) { dbg.log('JSON: після чистки Markdown ✓'); return r3; } } catch (e) {}

            dbg.log('JSON: всі рівні провалились. Початок тексту:', text.slice(0, 150));
            return null;
        };

        // ───────────────────────────────────────────────────────────────
        //  STRUCTURED OUTPUT CONTRACT — пріоритет #1 (після repair)
        // ───────────────────────────────────────────────────────────────

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
            dbg.log('Contract "' + schemaName + '": з ' + array.length + ' валідних ' + valid.length);
            return valid;
        };

        // ───────────────────────────────────────────────────────────────
        //  CACHE LAYER — GET завжди першим, до будь-якого AI запиту
        // ───────────────────────────────────────────────────────────────

        this.cacheKey = function (action, id) { return SK.cache_prefix + action + '_' + id; };

        this.cacheGet = function (action, id) {
            try {
                var raw = Lampa.Storage.get(_this.cacheKey(action, id), '');
                if (!raw) return null;
                var e = JSON.parse(raw);
                if (!e || e.version !== PLUGIN_VERSION) return null;
                if (Date.now() - e.timestamp > (CACHE_TTL[action] || CACHE_TTL.recommendations)) {
                    dbg.log('Кеш "' + action + '_' + id + '": протух');
                    return null;
                }
                dbg.log('Кеш "' + action + '_' + id + '": HIT ✓');
                return e.data;
            } catch (e) { return null; }
        };

        this.cacheSet = function (action, id, data) {
            try {
                Lampa.Storage.set(_this.cacheKey(action, id), JSON.stringify({
                    data: data, timestamp: Date.now(), version: PLUGIN_VERSION
                }));
                dbg.log('Кеш "' + action + '_' + id + '": збережено');
            } catch (e) { dbg.log('Кеш: помилка збереження —', e.message); }
        };

        // ───────────────────────────────────────────────────────────────
        //  PROVIDER MANAGER
        //  Gemini → OpenRouter → авто-повернення через TTL
        // ───────────────────────────────────────────────────────────────

        this.getProviderState = function () {
            try {
                var raw = Lampa.Storage.get(SK.provider_state, '');
                return raw ? JSON.parse(raw) : { gemini_failed_at: null, openrouter_failed_at: null };
            } catch (e) { return { gemini_failed_at: null, openrouter_failed_at: null }; }
        };

        this.saveProviderState = function (state) {
            try { Lampa.Storage.set(SK.provider_state, JSON.stringify(state)); } catch (e) {}
        };

        this.setProviderFailed = function (provider) {
            var s = _this.getProviderState();
            s[provider + '_failed_at'] = Date.now();
            _this.saveProviderState(s);
            dbg.log('Провайдер "' + provider + '" позначено недоступним');
        };

        this.isProviderAvailable = function (provider) {
            var s = _this.getProviderState();
            var failedAt = s[provider + '_failed_at'];
            if (!failedAt) return true;
            var recovered = (Date.now() - failedAt) > PROVIDER_TTL[provider];
            if (recovered) {
                s[provider + '_failed_at'] = null;
                _this.saveProviderState(s);
                dbg.log('Провайдер "' + provider + '" відновився автоматично ✓');
            }
            return recovered;
        };

        // Перевірка відновлення при старті сесії
        this.checkProviderRecovery = function () {
            var s = _this.getProviderState();
            var changed = false;
            ['gemini', 'openrouter'].forEach(function (p) {
                if (s[p + '_failed_at'] && (Date.now() - s[p + '_failed_at']) > PROVIDER_TTL[p]) {
                    s[p + '_failed_at'] = null;
                    changed = true;
                    dbg.log('Старт: провайдер "' + p + '" відновлено');
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
            return 'Недоступний';
        };

        // --- Запит до Gemini ---

        this.requestGemini = function (prompt, keys, modelIdx, useGrounding, onSuccess, onNextProvider) {
            if (modelIdx >= GEMINI_MODELS.length) {
                _this.setProviderFailed('gemini');
                onNextProvider();
                return;
            }
            var model = GEMINI_MODELS[modelIdx];
            var keyIdx = 0;

            var tryKey = function () {
                if (keyIdx >= keys.length) {
                    dbg.log('Gemini ' + model + ': всі ключі вичерпано');
                    _this.requestGemini(prompt, keys, modelIdx + 1, useGrounding, onSuccess, onNextProvider);
                    return;
                }
                var key = keys[keyIdx];
                var payload = { contents: [{ parts: [{ text: prompt }] }] };

                // Grounding ТІЛЬКИ для фактів і ТІЛЬКИ для gemini-2.5
                // Не вмикати для JSON-запитів рекомендацій — grounding додає цитати [1][2] що ламають JSON
                if (useGrounding && model.indexOf('gemini-2.5') === 0) {
                    payload.tools = [{ googleSearch: {} }];
                    dbg.log('Gemini: Grounding увімкнено для ' + model);
                }

                var t0 = Date.now();
                fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + key, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                })
                .then(function (r) {
                    return r.json().then(function (json) { return { status: r.status, ok: r.ok, data: json }; });
                })
                .then(function (res) {
                    dbg.log('Gemini ' + model + ': ' + res.status + ' (' + (Date.now() - t0) + 'мс)');
                    if (res.status === 429 || res.status === 503) { keyIdx++; tryKey(); return; }
                    if (res.status === 404) {
                        // Модель не існує — одразу до наступної
                        dbg.log('Gemini: модель ' + model + ' не знайдена (404)');
                        _this.requestGemini(prompt, keys, modelIdx + 1, useGrounding, onSuccess, onNextProvider);
                        return;
                    }
                    if (!res.ok) { dbg.log('Gemini: помилка ' + res.status); keyIdx++; tryKey(); return; }
                    if (res.data.candidates && res.data.candidates[0] && res.data.candidates[0].content) {
                        var text = res.data.candidates[0].content.parts.map(function (p) { return p.text || ''; }).join('\n');
                        dbg.log('Gemini: успіх через ' + model);
                        onSuccess(text);
                    } else {
                        dbg.log('Gemini: порожня відповідь від ' + model);
                        keyIdx++; tryKey();
                    }
                })
                .catch(function (err) {
                    dbg.log('Gemini: мережева помилка —', err.message);
                    keyIdx++; tryKey();
                });
            };
            tryKey();
        };

        // --- Запит до OpenRouter ---
        // response_format і plugins НЕ передаємо:
        // - підтримується не всіма безкоштовними моделями (deepseek-r1 ігнорує)
        // - наш JSON Repair Layer надійніший і універсальніший

        this.requestOpenRouter = function (prompt, key, modelIdx, onSuccess, onAllFailed) {
            if (modelIdx >= OPENROUTER_MODELS.length) {
                _this.setProviderFailed('openrouter');
                onAllFailed();
                return;
            }
            var model = OPENROUTER_MODELS[modelIdx];
            var t0 = Date.now();

            fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + key,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'https://lampa.mx',
                    'X-Title': 'AI Assistant for Lampa'
                },
                body: JSON.stringify({
                    model: model,
                    messages: [{ role: 'user', content: prompt }],
                    max_tokens: 4096
                })
            })
            .then(function (r) {
                return r.json().then(function (json) { return { status: r.status, ok: r.ok, data: json }; });
            })
            .then(function (res) {
                dbg.log('OpenRouter ' + model + ': ' + res.status + ' (' + (Date.now() - t0) + 'мс)');
                if (res.status === 429 || res.status === 503 || res.status === 402) {
                    _this.requestOpenRouter(prompt, key, modelIdx + 1, onSuccess, onAllFailed); return;
                }
                if (!res.ok) {
                    dbg.log('OpenRouter: помилка ' + res.status + ' для ' + model);
                    _this.requestOpenRouter(prompt, key, modelIdx + 1, onSuccess, onAllFailed); return;
                }
                if (res.data.choices && res.data.choices[0] && res.data.choices[0].message) {
                    dbg.log('OpenRouter: успіх через ' + model);
                    onSuccess(res.data.choices[0].message.content);
                } else {
                    dbg.log('OpenRouter: порожня відповідь від ' + model);
                    _this.requestOpenRouter(prompt, key, modelIdx + 1, onSuccess, onAllFailed);
                }
            })
            .catch(function (err) {
                dbg.log('OpenRouter: мережева помилка —', err.message);
                _this.requestOpenRouter(prompt, key, modelIdx + 1, onSuccess, onAllFailed);
            });
        };

        // --- Головна функція AI запиту (єдина точка входу) ---

        this.request = function (prompt, onSuccess, onError, options) {
            options = options || {};
            var useGrounding = options.useGrounding || false;
            var isSilent     = options.isSilent || false;

            var geminiRaw = Lampa.Storage.get(SK.gemini_key, '');
            var orKey     = Lampa.Storage.get(SK.openrouter_key, '');
            var mode      = Lampa.Storage.get(SK.provider_mode, 'auto');

            var geminiKeys = geminiRaw
                ? geminiRaw.split(',').map(function (k) { return k.trim(); }).filter(Boolean)
                : [];

            var hasGemini = geminiKeys.length > 0;
            var hasOR     = !!orKey;

            if (!hasGemini && !hasOR) {
                if (!isSilent) Lampa.Noty.show('ШІ спить \uD83D\uDE34 Додайте API ключ у налаштуваннях');
                if (onError) onError('no_keys');
                return;
            }

            var canGemini = hasGemini && (mode === 'auto' || mode === 'gemini_only') && _this.isProviderAvailable('gemini');
            var canOR     = hasOR     && (mode === 'auto' || mode === 'openrouter_only') && _this.isProviderAvailable('openrouter');

            var handleAllFailed = function () {
                if (!isSilent) Lampa.Noty.show('Ліміти вичерпано. Спробуйте пізніше');
                if (onError) onError('all_failed');
            };

            var tryOpenRouter = function () {
                if (!canOR) { handleAllFailed(); return; }
                dbg.log('Перемикання на OpenRouter...');
                _this.requestOpenRouter(prompt, orKey, 0, onSuccess, handleAllFailed);
            };

            if (canGemini) {
                _this.requestGemini(prompt, geminiKeys, 0, useGrounding, onSuccess, tryOpenRouter);
            } else if (canOR) {
                tryOpenRouter();
            } else {
                handleAllFailed();
            }
        };

        // ───────────────────────────────────────────────────────────────
        //  TMDB CONTEXT BUILDER
        //  Єдине джерело контексту для всіх AI функцій.
        //  Один запит замість двох (credits + keywords об'єднані).
        //  Замінює: getTMDBDetails + runOwnTagTranslation (дублювання усунено)
        // ───────────────────────────────────────────────────────────────

        this.buildTMDBContext = function (card, callback) {
            var method = (card.name || card.original_name) ? 'tv' : 'movie';
            var url = Lampa.TMDB.api(
                method + '/' + card.id +
                '?api_key=' + Lampa.TMDB.key() +
                '&language=en-US' +
                '&append_to_response=credits,keywords,similar,external_ids'
            );

            var t0 = Date.now();
            Lampa.Network.silent(url, function (res) {
                dbg.log('TMDB Context: отримано за ' + (Date.now() - t0) + 'мс');
                var ctx = {};

                // Базові поля
                ctx.title             = res.title || res.name || card.title || card.name || '';
                ctx.original_title    = res.original_title || res.original_name || '';
                ctx.year              = (res.release_date || res.first_air_date || '').slice(0, 4);
                ctx.overview          = (res.overview || '').replace(/"/g, "'").replace(/\n/g, ' ').slice(0, 500);
                ctx.vote_average      = res.vote_average || 0;
                ctx.type              = method === 'tv' ? 'TV series' : 'movie';
                ctx.status            = res.status || '';
                ctx.number_of_seasons = res.number_of_seasons || null;
                ctx.belongs_to_collection = res.belongs_to_collection || null;

                // Жанри та країни
                ctx.genres    = (res.genres || []).map(function (g) { return g.name; }).join(', ');
                ctx.countries = (res.production_countries || []).map(function (c) { return c.name; }).join(', ');
                ctx.original_language = res.original_language || '';

                // Колекція/франшиза
                ctx.collection = (res.belongs_to_collection || {}).name || '';

                // IMDb ID — передаємо AI для контексту рейтингів і рецензій
                ctx.imdb_id = (res.external_ids || {}).imdb_id || '';

                // Режисер / автор
                ctx.director    = '';
                ctx.writers     = [];
                ctx.lead_actors = [];

                if (res.credits) {
                    var crew = res.credits.crew || [];

                    // Для фільму — Director, для серіалу — created_by або Executive Producer
                    var dirObj = crew.find(function (c) { return c.job === 'Director'; });
                    if (!dirObj && res.created_by && res.created_by.length) {
                        dirObj = res.created_by[0];
                    }
                    if (!dirObj) {
                        dirObj = crew.find(function (c) { return c.job === 'Executive Producer'; });
                    }
                    ctx.director = dirObj ? dirObj.name : '';

                    // Сценаристи (топ-2)
                    ctx.writers = crew
                        .filter(function (c) {
                            return c.job === 'Writer' || c.job === 'Screenplay' || c.job === 'Story';
                        })
                        .slice(0, 2)
                        .map(function (c) { return c.name; });

                    // Актори (топ-3)
                    ctx.lead_actors = (res.credits.cast || [])
                        .slice(0, 3)
                        .map(function (c) { return c.name; });
                }

                // Ключові слова
                var kwObj   = res.keywords || {};
                var kwArray = kwObj.keywords || kwObj.results || [];
                ctx.keywords_raw = kwArray.slice(0, 15);
                ctx.keywords     = kwArray.slice(0, 10).map(function (k) { return k.name; }).join(', ');

                // Записуємо теги у картку якщо їх ще немає
                // buildTMDBContext є єдиним джерелом — preloadTags лише запасний варіант
                if (kwArray.length > 0 && card.translated_tags === undefined) {
                    card.translated_tags = null; // null = "в процесі перекладу"
                    var tagsForTranslation = ctx.keywords_raw.map(function (k) {
                        return { name: k.name, id: k.id, orig_name: k.name };
                    });
                    _this.translateTags(tagsForTranslation, function (tags) {
                        card.translated_tags = tags;
                    });
                }

                // Схожі (TMDB) — щоб AI не рекомендував вже показані TMDB-ом
                ctx.similar_titles = ((res.similar || {}).results || [])
                    .slice(0, 5)
                    .map(function (s) { return s.title || s.name; })
                    .join(', ');

                // Оновлюємо картку даними з TMDB якщо вони були відсутні
                if (ctx.belongs_to_collection && !card.belongs_to_collection) {
                    card.belongs_to_collection = ctx.belongs_to_collection;
                }
                if (ctx.number_of_seasons && !card.number_of_seasons) {
                    card.number_of_seasons = ctx.number_of_seasons;
                }

                callback(ctx);

            }, function () {
                // Fallback — мінімальний контекст з даних картки
                dbg.log('TMDB Context: помилка запиту, використовуємо fallback');
                callback({
                    title:             card.title || card.name || '',
                    original_title:    card.original_title || card.original_name || '',
                    year:              (card.release_date || card.first_air_date || '').slice(0, 4),
                    overview:          (card.overview || '').slice(0, 300),
                    type:              (card.name || card.original_name) ? 'TV series' : 'movie',
                    genres:            '',
                    countries:         '',
                    director:          '',
                    writers:           [],
                    lead_actors:       [],
                    keywords:          '',
                    keywords_raw:      [],
                    imdb_id:           '',
                    collection:        '',
                    similar_titles:    '',
                    vote_average:      0,
                    original_language: '',
                    belongs_to_collection: card.belongs_to_collection || null,
                    number_of_seasons:    card.number_of_seasons || null,
                });
            });
        };

        // ───────────────────────────────────────────────────────────────
        //  PROMPT BUILDER — всі промпти централізовані тут
        // ───────────────────────────────────────────────────────────────

        this.getBlocklistPromptLine = function () {
            var bl    = _this.getBlocklist();
            var parts = [];
            if (bl.genres     && bl.genres.length)     parts.push('жанри: ' + bl.genres.join(', '));
            if (bl.franchises && bl.franchises.length)  parts.push('франшизи/студії: ' + bl.franchises.join(', '));
            return parts.length
                ? 'НІКОЛИ не рекомендуй (' + parts.join(' та ') + ').'
                : '';
        };

        this.buildRecommendationsPrompt = function (ctx, limit) {
            var bl          = _this.getBlocklistPromptLine();
            var actorsStr   = ctx.lead_actors && ctx.lead_actors.length ? ctx.lead_actors.join(', ') : 'не вказано';
            var writersStr  = ctx.writers     && ctx.writers.length     ? ctx.writers.join(', ')     : '';

            return 'Ти — видатний кінознавець зі знанням світового кінематографу.\n\n' +
                'Контекст фільму/серіалу:\n' +
                '- Назва: "' + ctx.title + '" (' + ctx.year + '), ' + ctx.type + '\n' +
                (ctx.director  ? '- Режисер/автор: ' + ctx.director + '\n' : '') +
                (writersStr    ? '- Сценаристи: '   + writersStr   + '\n' : '') +
                '- Актори: ' + actorsStr + '\n' +
                (ctx.genres    ? '- Жанри: '    + ctx.genres    + '\n' : '') +
                (ctx.countries ? '- Країни: '   + ctx.countries + '\n' : '') +
                (ctx.imdb_id   ? '- IMDb ID: '  + ctx.imdb_id  + ' (використай свої знання про рейтинги та рецензії)\n' : '') +
                (ctx.keywords  ? '- Теми/теги: ' + ctx.keywords + '\n' : '') +
                (ctx.collection ? '- Колекція: ' + ctx.collection + '\n' : '') +
                (ctx.overview  ? '- Опис: "'    + ctx.overview  + '"\n' : '') +
                '\nЗнайди рівно ' + limit + ' фільмів або серіалів зі схожим ЕМОЦІЙНИМ СТРИЖНЕМ та ТЕМАТИЧНИМ ДНК.\n\n' +
                'ПРАВИЛА:\n' +
                '1. Надавай перевагу прихованим шедеврам — уникай фільмів з понад 100 000 оцінок на IMDb\n' +
                '2. Включай фільми з різних країн та епох\n' +
                '3. Ніколи не рекомендуй сиквели, приквели, рімейки або спін-офи "' + ctx.title + '"\n' +
                (ctx.similar_titles ? '4. НЕ рекомендуй (вже показані TMDB): ' + ctx.similar_titles + '\n' : '') +
                '5. Надавай перевагу фільмам з українським дублюванням або субтитрами\n' +
                (bl ? '6. ' + bl + '\n' : '') +
                '\nПоверни ТІЛЬКИ валідний JSON масив, без markdown та вступного тексту:\n' +
                '[{"uk":"Назва українською","orig":"Original Title","year":2020,"why":"Одне речення чому схоже — українською"}]';
        };

        this.buildFactsPrompt = function (ctx) {
            return 'Ти — кінознавець та кіноісторик.\n\n' +
                'Надай 7 несподіваних та ПІДТВЕРДЖЕНИХ фактів про ' + ctx.type +
                ' "' + ctx.original_title + '" (' + ctx.year + ')' +
                (ctx.director ? ', режисер ' + ctx.director : '') + '.\n\n' +
                'ПРІОРИТЕТ ТИПІВ ФАКТІВ:\n' +
                '1. Закулісні таємниці та випадки на знімальному майданчику\n' +
                '2. Реальні прототипи персонажів або подій\n' +
                '3. Сцени що ледь не були вирізані або знімались інакше\n' +
                '4. Зв\'язок з реальними історичними подіями або іншими фільмами\n' +
                '5. Несподіваний касовий результат або зміна критичної оцінки з часом\n\n' +
                'ЗАБОРОНЕНО: дата виходу, базовий переказ сюжету, списки номінацій, бюджет.\n' +
                'Якщо не можеш знайти 7 підтверджених фактів — поверни менше, не вигадуй.\n\n' +
                'Мова відповіді: українська.\n\n' +
                'Поверни ТІЛЬКИ JSON масив:\n' +
                '[{"title":"Коротка назва факту","text":"Детальний опис 2-3 речення"}]';
        };

        this.buildRecapPrompt = function (itemTitle, franchiseTitle, year) {
            return 'Зроби стислий переказ зі спойлерами для "' + itemTitle +
                '" з франшизи "' + franchiseTitle + '" (' + year + '). Мова: українська.\n\n' +
                'Структура (JSON пункти):\n' +
                '- Основна сюжетна арка (3-4 пункти)\n' +
                '- Ключовий розвиток персонажів (2-3 пункти)\n' +
                '- Шокуючі моменти або кліфхенгери (2-3 пункти)\n' +
                '- Що важливо пам\'ятати для наступної частини (1-2 пункти)\n\n' +
                'Поверни ТІЛЬКИ JSON масив з 8-12 пунктами:\n' +
                '[{"point":"..."}]';
        };

        this.buildTagsPrompt = function (tagOrigName, limit) {
            var bl = _this.getBlocklistPromptLine();
            return 'Запропонуй рівно ' + limit + ' фільмів або серіалів що тісно пов\'язані з TMDB тегом: "' + tagOrigName + '".\n' +
                'Включай фільми з різних країн та епох.\n' +
                'Надавай перевагу фільмам з українським дублюванням або субтитрами.\n' +
                (bl ? bl + '\n' : '') +
                'Поверни ТІЛЬКИ валідний JSON масив:\n' +
                '[{"uk":"Назва","orig":"Original Title","year":2020}]';
        };

        this.detectMoodFromQuery = function (q) {
            var lq    = q.toLowerCase();
            var moods = [];
            var map   = [
                { keys: ['страшн', 'жахл', 'хорор', 'лякати'],       mood: 'horror, psychological fear, suspense' },
                { keys: ['смішн', 'комеді', 'сміятись', 'жарт'],     mood: 'comedy, lighthearted, fun' },
                { keys: ['плакат', 'зворушл', 'сльози', 'сумн'],     mood: 'emotional drama, tearjerker, melancholic' },
                { keys: ['екшн', 'бойов', 'динамічн', 'пригод'],     mood: 'action-packed, high energy, adventure' },
                { keys: ['романтич', 'любов', 'кохання'],             mood: 'romance, love story' },
                { keys: ['думат', 'розумн', 'складн', 'філософ'],    mood: 'thought-provoking, intellectual' },
                { keys: ['дит', 'сімейн', 'мультфільм', 'анімац'],  mood: 'family friendly, animation' },
                { keys: ['воєн', 'військ', 'солдат'],                 mood: 'war drama, military' },
                { keys: ['похмур', 'темн', 'депресивн', 'важк'],     mood: 'dark, atmospheric, gritty' },
                { keys: ['розслаб', 'легк', 'фоново'],                mood: 'easy watching, relaxing, feel-good' },
            ];
            map.forEach(function (entry) {
                if (entry.keys.some(function (k) { return lq.indexOf(k) > -1; })) {
                    moods.push(entry.mood);
                }
            });
            return moods.join('; ');
        };

        this.buildSearchPrompt = function (query, limit) {
            var mood     = _this.detectMoodFromQuery(query);
            var lq       = query.toLowerCase();
            var isMovie  = lq.indexOf('фільм')  > -1;
            var isSeries = lq.indexOf('серіал') > -1;
            var filter   = isMovie ? 'суто фільми' : (isSeries ? 'суто серіали' : 'фільми та серіали');
            var bl       = _this.getBlocklistPromptLine();

            return 'Ти — кінознавець. Запропонуй рівно ' + limit + ' ' + filter + ' за запитом: "' + query + '".\n' +
                (mood ? 'Необхідний настрій/тон: ' + mood + '\n' : '') +
                'Надавай перевагу назвам з українським дублюванням або субтитрами.\n' +
                (bl ? bl + '\n' : '') +
                'Поверни ТІЛЬКИ валідний JSON масив:\n' +
                '[{"uk":"Назва","orig":"Original Title","year":2020}]';
        };

        // ───────────────────────────────────────────────────────────────
        //  processAiList — паралельні запити + timeout 12с + client dedup
        //  Збережено повністю: exclude_ids, WHY поле, pagination сумісність
        // ───────────────────────────────────────────────────────────────

        this.processAiList = function (list, callback) {
            if (!window.ai_pagination.exclude_ids) window.ai_pagination.exclude_ids = [];
            if (!list || !list.length) { callback([]); return; }

            var results   = [];
            var completed = 0;
            var total     = list.length;
            var finished  = false;

            var finish = function () {
                if (finished) return;
                finished = true;
                dbg.log('processAiList: ' + results.length + ' з ' + total + ' знайдено');
                callback(results);
            };

            // Глобальний timeout — захист від вічного зависання
            var globalTimeout = setTimeout(function () {
                dbg.log('processAiList: timeout 12с, повертаємо ' + results.length + ' результатів');
                finish();
            }, 12000);

            list.forEach(function (item) {
                var q = ((item.orig || item.uk || '')).trim();
                if (!q) {
                    completed++;
                    if (completed === total) { clearTimeout(globalTimeout); finish(); }
                    return;
                }

                Lampa.Network.silent(
                    Lampa.TMDB.api('search/multi?query=' + encodeURIComponent(q) +
                        '&api_key=' + Lampa.TMDB.key() + '&language=uk-UA'),
                    function (res) {
                        completed++;
                        if (res.results && res.results[0]) {
                            var b = res.results[0];
                            // Дедублікація по TMDB ID на клієнті (не в промпті — економить токени)
                            if (b.media_type !== 'person' &&
                                window.ai_pagination.exclude_ids.indexOf(b.id) === -1) {
                                window.ai_pagination.exclude_ids.push(b.id);
                                b.source = 'tmdb';
                                if (item.why) b.ai_why = item.why; // зберігаємо WHY пояснення
                                results.push(b);
                            }
                        }
                        if (completed === total) { clearTimeout(globalTimeout); finish(); }
                    },
                    function () {
                        // Помилка одного запиту — не зупиняємо все, рухаємось далі
                        completed++;
                        if (completed === total) { clearTimeout(globalTimeout); finish(); }
                    }
                );
            });
        };

        // ───────────────────────────────────────────────────────────────
        //  BLOCKLIST
        // ───────────────────────────────────────────────────────────────

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
            var listContainer = $('<div></div>');
            var itemsWrapper  = $('<div style="margin-bottom:14px;min-height:30px;"></div>');
            listContainer.append(itemsWrapper);

            var renderList = function () {
                itemsWrapper.empty();
                var allItems = [];
                (bl.genres     || []).forEach(function (g) { allItems.push({ text: g, type: 'genres',     label: 'жанр' }); });
                (bl.franchises || []).forEach(function (f) { allItems.push({ text: f, type: 'franchises', label: 'франшиза' }); });

                if (!allItems.length) {
                    itemsWrapper.append('<div style="opacity:0.5;padding:10px 0;font-size:0.95em;">Список порожній — всі жанри та франшизи дозволені</div>');
                    return;
                }
                allItems.forEach(function (item) {
                    var row = $('<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.07);">' +
                        '<span style="font-size:0.95em;">' + item.text +
                        ' <span style="opacity:0.4;font-size:0.8em;">(' + item.label + ')</span></span>' +
                        '<div class="bl-del selector" style="padding:5px 12px;border-radius:6px;background:rgba(255,50,50,0.15);font-size:0.85em;">&#10005; Видалити</div>' +
                        '</div>');
                    row.find('.bl-del').on('hover:enter click', function () {
                        var arr = bl[item.type];
                        var idx = arr.indexOf(item.text);
                        if (idx > -1) arr.splice(idx, 1);
                        _this.saveBlocklist(bl);
                        renderList();
                    });
                    itemsWrapper.append(row);
                });
            };

            var addSection = $('<div style="margin-top:10px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.1);">' +
                '<div style="margin-bottom:8px;font-size:0.9em;opacity:0.6;">Додати нове виключення:</div>' +
                '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
                '<div class="bl-add-genre selector" style="padding:7px 14px;border-radius:8px;background:rgba(255,255,255,0.08);font-size:0.9em;">+ Жанр</div>' +
                '<div class="bl-add-fr selector" style="padding:7px 14px;border-radius:8px;background:rgba(255,255,255,0.08);font-size:0.9em;">+ Франшиза / Студія</div>' +
                '</div></div>');

            var addItem = function (type, label) {
                Lampa.Input.edit({ title: 'Додати ' + label, value: '', free: true }, function (val) {
                    val = (val || '').trim();
                    if (!val) return;
                    if (!bl[type]) bl[type] = [];
                    if (bl[type].indexOf(val) === -1) { bl[type].push(val); _this.saveBlocklist(bl); renderList(); }
                });
            };
            addSection.find('.bl-add-genre').on('hover:enter click', function () { addItem('genres',     'жанр'); });
            addSection.find('.bl-add-fr').on('hover:enter click',    function () { addItem('franchises', 'франшизу/студію'); });
            listContainer.append(addSection);
            renderList();

            Lampa.Modal.open({
                title: 'Блок-лист', html: listContainer, size: 'small', scroll_to_center: true,
                onBack: function () { Lampa.Modal.close(); Lampa.Controller.toggle('settings_component'); }
            });
        };

        // ───────────────────────────────────────────────────────────────
        //  НАЛАШТУВАННЯ — стиль і розміри точно як на скріншоті
        // ───────────────────────────────────────────────────────────────

        this.setupSettings = function () {
            Lampa.SettingsApi.addComponent({ component: 'ai_assistant_cfg', name: 'AI Асистент', icon: PLUGIN_ICON });

            // 1. Gemini API key
            Lampa.SettingsApi.addParam({
                component: 'ai_assistant_cfg',
                param: { name: 'ai_gemini_key_trigger', type: 'trigger' },
                field: { name: 'Gemini API key', description: 'aistudio.google.com/api-keys — можна вказати кілька через кому' },
                onRender: function (item) {
                    var upd = function () {
                        var v = Lampa.Storage.get(SK.gemini_key, '');
                        item.find('.settings-param__value').text(v ? 'Так' : 'Ні').css('color', v ? '#4b5' : '#f55');
                    };
                    upd();
                    item.on('hover:enter', function () {
                        Lampa.Input.edit({ title: 'Gemini API key', value: Lampa.Storage.get(SK.gemini_key, ''), free: true }, function (v) {
                            if (v !== undefined) { Lampa.Storage.set(SK.gemini_key, v.trim()); upd(); }
                        });
                    });
                }
            });

            // 2. OpenRouter API key
            Lampa.SettingsApi.addParam({
                component: 'ai_assistant_cfg',
                param: { name: 'ai_openrouter_key_trigger', type: 'trigger' },
                field: { name: 'OpenRouter API key', description: 'openrouter.ai/keys — резервний провайдер при вичерпанні Gemini' },
                onRender: function (item) {
                    var upd = function () {
                        var v = Lampa.Storage.get(SK.openrouter_key, '');
                        item.find('.settings-param__value').text(v ? 'Так' : 'Ні').css('color', v ? '#4b5' : '#f55');
                    };
                    upd();
                    item.on('hover:enter', function () {
                        Lampa.Input.edit({ title: 'OpenRouter API key', value: Lampa.Storage.get(SK.openrouter_key, ''), free: true }, function (v) {
                            if (v !== undefined) { Lampa.Storage.set(SK.openrouter_key, v.trim()); upd(); }
                        });
                    });
                }
            });

            // 3. Режим провайдерів
            Lampa.SettingsApi.addParam({
                component: 'ai_assistant_cfg',
                param: {
                    name: SK.provider_mode, type: 'select',
                    values: { 'auto': 'Авто (Gemini \u2192 OpenRouter)', 'gemini_only': 'Тільки Gemini', 'openrouter_only': 'Тільки OpenRouter' },
                    default: 'auto'
                },
                field: { name: 'Режим провайдерів' }
            });

            // 4. Активний провайдер — лише інформативно, не клікабельний
            Lampa.SettingsApi.addParam({
                component: 'ai_assistant_cfg',
                param: { name: 'ai_active_provider_info', type: 'trigger' },
                field: { name: 'Провайдер', description: 'Поточний активний AI провайдер' },
                onRender: function (item) {
                    item.find('.settings-param__value').text(_this.getActiveProviderName()).css('color', '#fff');
                    item.css('cursor', 'default').off('hover:enter');
                }
            });

            // 5. Кількість результатів
            Lampa.SettingsApi.addParam({
                component: 'ai_assistant_cfg',
                param: { name: SK.result_count, type: 'select', values: { '10':'10','20':'20','30':'30','50':'50' }, default: '20' },
                field: { name: 'Кількість результатів' }
            });

            // 6. Розмір тексту
            Lampa.SettingsApi.addParam({
                component: 'ai_assistant_cfg',
                param: {
                    name: SK.font_size, type: 'select',
                    values: { '1.1em':'1.1em','1.2em':'1.2em','1.3em':'1.3em','1.4em':'1.4em','1.5em':'1.5em','1.6em':'1.6em' },
                    default: '1.2em'
                },
                field: { name: 'Розмір тексту' }
            });

            // 7. Блок-лист
            Lampa.SettingsApi.addParam({
                component: 'ai_assistant_cfg',
                param: { type: 'button', name: 'ai_blocklist_trigger' },
                field: { name: 'Блок-лист', description: 'Виключити жанри та франшизи з рекомендацій' },
                onChange: function () { _this.showBlocklistEditor(); }
            });

            // 8. Debug режим (для діагностики проблем)
            Lampa.SettingsApi.addParam({
                component: 'ai_assistant_cfg',
                param: { name: SK.debug_mode, type: 'select', values: { 'false':'Вимкнено','true':'Увімкнено' }, default: 'false' },
                field: { name: 'Debug режим', description: 'Технічні деталі у консолі браузера' }
            });
        };

        // ───────────────────────────────────────────────────────────────
        //  ГЛОБАЛЬНИЙ AI ПОШУК з кешем та mood-розпізнаванням
        // ───────────────────────────────────────────────────────────────

        this.setupGlobalSearch = function () {
            var searchSource = {
                title: 'AI Пошук',
                search: function (params, done) {
                    var q     = decodeURIComponent(params.query || '').trim();
                    var limit = Lampa.Storage.get(SK.result_count, '20');
                    if (!q) return done([]);

                    // Cache GET для пошуку
                    var cid    = 'q_' + q.replace(/\W+/g, '_').slice(0, 40);
                    var cached = _this.cacheGet('search', cid);
                    if (cached) {
                        done([{ title: 'AI: ' + q, results: cached, total: cached.length }]);
                        return;
                    }

                    var p = _this.buildSearchPrompt(q, limit);
                    window.ai_active_controller = Lampa.Controller.enabled().name;
                    _this.updateStatus('Пошук результатів');

                    _this.request(p, function (text) {
                        var list      = _this.parseJsonSafe(text);
                        var validated = _this.applyContract(list, 'search');
                        if (!validated || !validated.length) { _this.hideStatus(); done([]); return; }
                        _this.processAiList(validated, function (results) {
                            _this.hideStatus();
                            if (results.length) _this.cacheSet('search', cid, results);
                            done([{ title: 'AI: ' + q, results: results, total: results.length }]);
                        });
                    }, function () { _this.hideStatus(); done([]); });
                },
                params: { save: true, lazy: true },
                onSelect: function (p, close) {
                    close();
                    Lampa.Activity.push({
                        url: p.element.media_type + '/' + p.element.id,
                        component: 'full', id: p.element.id,
                        method: p.element.media_type, card: p.element, source: 'tmdb'
                    });
                }
            };
            setTimeout(function () {
                var s = Lampa.Search.sources ? Lampa.Search.sources() : [];
                if (s.length >= 2) s.splice(2, 0, searchSource); else Lampa.Search.addSource(searchSource);
            }, 1500);
        };

        // ───────────────────────────────────────────────────────────────
        //  ТЕГИ — preload (запасний варіант) та переклад
        //  buildTMDBContext є основним джерелом тегів
        // ───────────────────────────────────────────────────────────────

        this.preloadTags = function (card) {
            if (card.translated_tags !== undefined) return;
            card.translated_tags = null;
            setTimeout(function () {
                if (card.translated_tags !== null) return; // buildTMDBContext вже поклав
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
                    if (tags.length > 0) {
                        _this.translateTags(tags, function (t) { card.translated_tags = t; });
                    } else { card.translated_tags = []; }
                },
                error: function () { card.translated_tags = []; }
            });
        };

        this.translateTags = function (tags, callback) {
            var lang = Lampa.Storage.get('language', 'uk');
            tags.forEach(function (t) { if (!t.orig_name) t.orig_name = t.name; });
            if (lang !== 'uk') return callback(tags);

            var tagsWithCtx = tags.map(function (t) { return 'Movie tag: ' + t.name; });
            $.ajax({
                url: 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=uk&dt=t&q=' +
                    encodeURIComponent(tagsWithCtx.join(' ||| ')),
                dataType: 'json',
                success: function (res) {
                    try {
                        var text = '';
                        if (res && res[0]) res[0].forEach(function (i) { if (i[0]) text += i[0]; });
                        var arr = text.split('|||');
                        tags.forEach(function (tag, idx) {
                            if (arr[idx]) {
                                tag.name = arr[idx]
                                    .replace(/позначка до фільму[:\s]*/gi, '')
                                    .replace(/тег до фільму[:\s]*/gi, '')
                                    .replace(/тег фільму[:\s]*/gi, '')
                                    .replace(/movie tag[:\s]*/gi, '')
                                    .replace(/^[:\s\-]*/, '').trim();
                            }
                        });
                        callback(tags);
                    } catch (e) { callback(tags); }
                },
                error: function () { callback(tags); }
            });
        };

        // ───────────────────────────────────────────────────────────────
        //  КНОПКА НА КАРТЦІ ФІЛЬМУ
        // ───────────────────────────────────────────────────────────────

        this.drawButton = function (render, card) {
            var container = render.find('.full-start-new__buttons, .full-start__buttons').first();
            if (!container.length || container.find('.button--ai-assist').length) return;
            var btn = $('<div class="full-start__button selector button--ai-assist">' + PLUGIN_ICON + '<span>AI Асистент</span></div>');
            btn.on('hover:enter click', function () { _this.openAiMenu(card, btn, render); });
            var lastBtn = container.find('.selector').last();
            if (lastBtn.length) lastBtn.after(btn); else container.append(btn);
        };

        // ───────────────────────────────────────────────────────────────
        //  МЕНЮ AI АСИСТЕНТА
        // ───────────────────────────────────────────────────────────────

        this.openAiMenu = function (card, btnElement, renderContainer, prevCtrl) {
            var ctrl  = prevCtrl || Lampa.Controller.enabled().name;
            var items = [
                { title: 'Рекомендації', action: 'recommendations' },
                { title: 'Цікаві факти',  action: 'facts' }
            ];
            if (card.translated_tags && card.translated_tags.length > 0) {
                items.splice(1, 0, { title: 'Добірки за тегами', action: 'tags' });
            }
            if ((card.number_of_seasons && card.number_of_seasons > 1) || card.belongs_to_collection) {
                items.push({ title: 'Стислий переказ', action: 'recap' });
            }
            Lampa.Select.show({
                title: 'AI Асистент', items: items,
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

        // ───────────────────────────────────────────────────────────────
        //  ACTION: РЕКОМЕНДАЦІЇ
        //  Потік: Cache GET → TMDB Context → Prompt → AI → Contract → Cache SET → UI
        // ───────────────────────────────────────────────────────────────

        this.actionRecommendations = function (card, btn, render, ctrl) {
            if (!_this.checkApiKey(btn, render, ctrl)) return;
            var limit = Lampa.Storage.get(SK.result_count, '20');
            window.ai_active_controller = ctrl || Lampa.Controller.enabled().name;

            // Cache GET — перший у ланцюжку
            var cached = _this.cacheGet('recommendations', card.id);
            if (cached) {
                window.ai_cached_results = cached.slice();
                window.ai_cached_results.push({ id:'ai_load_more', is_load_more:true, name:'',
                    poster:'https://bodya-elven.github.io/different/icons/more.webp',
                    img:'https://bodya-elven.github.io/different/icons/more.webp' });
                Lampa.Activity.push({ url:'ai_assistant_list', title:'Рекомендації', component:'category_full', source:'ai_assistant_list', page:1 });
                return;
            }

            _this.updateStatus('Аналіз фільму');
            _this.buildTMDBContext(card, function (ctx) {
                _this.fetchList(_this.buildRecommendationsPrompt(ctx, limit), 'Рекомендації', card, btn, render, ctrl, 'recommendations');
            });
        };

        // ───────────────────────────────────────────────────────────────
        //  ACTION: ЦІКАВІ ФАКТИ
        //  Grounding вмикається тільки тут і тільки для gemini-2.5
        // ───────────────────────────────────────────────────────────────

        this.actionFacts = function (card, btn, render, ctrl) {
            if (!_this.checkApiKey(btn, render, ctrl)) return;
            var ukrT = card.title || card.name;
            window.ai_active_controller = ctrl || Lampa.Controller.enabled().name;

            // Cache GET
            var cached = _this.cacheGet('facts', card.id);
            if (cached) { _this.showViewer('Цікаві факти: ' + ukrT, cached, btn, render, ctrl); return; }

            _this.updateStatus('Збір фактів');
            _this.buildTMDBContext(card, function (ctx) {
                _this.request(_this.buildFactsPrompt(ctx), function (text) {
                    _this.hideStatus();
                    if (Lampa.Activity.active() && Lampa.Activity.active().component !== 'full') return;

                    var data      = _this.parseJsonSafe(text);
                    var validated = _this.applyContract(data, 'fact');
                    if (!validated || !validated.length) {
                        Lampa.Noty.show('Не вдалося отримати факти — спробуйте ще раз');
                        _this.restoreFocus(btn, render, ctrl); return;
                    }

                    var html = validated.map(function (f) {
                        var clean = (f.text || '').replace(/\[\d+(?:,\s*\d+)*\]/g, '').trim();
                        return '<div style="margin-bottom:14px"><span class="ai-fact-title">' + f.title + '</span>' + clean + '</div>';
                    }).join('');

                    _this.cacheSet('facts', card.id, html);
                    _this.showViewer('Цікаві факти: ' + ukrT, html, btn, render, ctrl);

                }, function () {
                    _this.hideStatus(); _this.restoreFocus(btn, render, ctrl);
                }, { useGrounding: true });
            });
        };

        // ───────────────────────────────────────────────────────────────
        //  ACTION: ТЕГИ
        // ───────────────────────────────────────────────────────────────

        this.actionTags = function (card, btn, render, ctrl) {
            if (!_this.checkApiKey(btn, render, ctrl)) return;
            if (card.translated_tags && card.translated_tags.length > 0) {
                _this.showTagsMenu(card.translated_tags, card, btn, render, ctrl);
            } else { _this.restoreFocus(btn, render, ctrl); }
        };

        this.showTagsMenu = function (tags, card, btn, render, ctrl) {
            var items = tags.map(function (tag) {
                return { title: tag.name.charAt(0).toUpperCase() + tag.name.slice(1), tag_data: tag };
            });
            Lampa.Select.show({
                title: 'Оберіть тег', items: items,
                onSelect: function (item) {
                    var limit = Lampa.Storage.get(SK.result_count, '20');
                    _this.fetchList(_this.buildTagsPrompt(item.tag_data.orig_name, limit), 'Тег: ' + item.title, card, btn, render, ctrl, null);
                },
                onBack: function () { _this.openAiMenu(card, btn, render, ctrl); }
            });
        };

        // ───────────────────────────────────────────────────────────────
        //  ACTION: ПЕРЕКАЗ
        // ───────────────────────────────────────────────────────────────

        this.actionRecapMenu = function (card, btn, render, ctrl) {
            if (!_this.checkApiKey(btn, render, ctrl)) return;
            var items = [];

            if (card.number_of_seasons > 1) {
                for (var i = 1; i < card.number_of_seasons; i++) {
                    items.push({ title: 'Сезон ' + i, type: 'season', value: i });
                }
                _this.showRecapSelect(items, card, btn, render, ctrl);
            } else if (card.belongs_to_collection) {
                window.ai_active_controller = ctrl || Lampa.Controller.enabled().name;
                _this.updateStatus('Збір колекції');
                Lampa.Network.silent(
                    Lampa.TMDB.api('collection/' + card.belongs_to_collection.id + '?api_key=' + Lampa.TMDB.key() + '&language=uk-UA'),
                    function (res) {
                        _this.hideStatus();
                        (res.parts || []).forEach(function (p) {
                            if (p.id != card.id) items.push({ title: p.title, type: 'movie', value: p.original_title });
                        });
                        _this.showRecapSelect(items, card, btn, render, ctrl);
                    },
                    function () {
                        _this.hideStatus();
                        Lampa.Noty.show('Помилка завантаження колекції');
                        if (window.ai_active_controller) Lampa.Controller.toggle(window.ai_active_controller);
                    }
                );
            }
        };

        this.showRecapSelect = function (items, card, btn, render, ctrl) {
            Lampa.Select.show({
                title: 'Що переказати?', items: items,
                onSelect: function (item) {
                    var franchiseTitle = card.original_title || card.original_name;
                    var year           = (card.release_date || card.first_air_date || '').slice(0, 4);
                    var cid            = card.id + '_' + item.title.replace(/\W/g, '_');

                    // Cache GET
                    var cached = _this.cacheGet('recap', cid);
                    if (cached) { _this.showViewer('Переказ: ' + item.title, cached, btn, render, ctrl); return; }

                    window.ai_active_controller = Lampa.Controller.enabled().name;
                    _this.updateStatus('Підготовка переказу');

                    _this.request(_this.buildRecapPrompt(item.title, franchiseTitle, year), function (text) {
                        _this.hideStatus();
                        if (Lampa.Activity.active().component !== 'full') return;

                        var data      = _this.parseJsonSafe(text);
                        var validated = _this.applyContract(data, 'recap');
                        if (!validated || !validated.length) {
                            Lampa.Noty.show('Помилка обробки переказу — спробуйте ще раз');
                            if (window.ai_active_controller) Lampa.Controller.toggle(window.ai_active_controller); return;
                        }
                        var html = validated.map(function (i) {
                            return '<div style="margin-bottom:10px">\u2022 ' + i.point + '</div>';
                        }).join('');
                        _this.cacheSet('recap', cid, html);
                        _this.showViewer('Переказ: ' + item.title, html, btn, render, ctrl);

                    }, function () {
                        _this.hideStatus();
                        if (window.ai_active_controller) Lampa.Controller.toggle(window.ai_active_controller);
                    });
                },
                onBack: function () { _this.openAiMenu(card, btn, render, ctrl); }
            });
        };

        // ───────────────────────────────────────────────────────────────
        //  FETCH LIST + PAGINATION
        //  Збережено повністю: preloadNextPage, loadMore, exclude_ids
        // ───────────────────────────────────────────────────────────────

        this.fetchList = function (base_prompt, title, card, btn, render, ctrl, cacheAction) {
            window.ai_pagination = {
                base_prompt: base_prompt, exclude_list: [], exclude_ids: [],
                preloaded_results: null, preloaded_raw_list: null,
                is_loading: false, is_preloading: false
            };
            window.ai_cached_results    = [];
            window.ai_active_controller = ctrl || Lampa.Controller.enabled().name;

            var full_prompt = base_prompt + '\nПоверни ТІЛЬКИ валідний JSON масив. Без markdown та вступного тексту.';

            _this.updateStatus('Підбір результатів');
            _this.request(full_prompt, function (text) {
                var list      = _this.parseJsonSafe(text);
                var validated = _this.applyContract(list, 'recommendation');

                if (Lampa.Activity.active() && Lampa.Activity.active().component !== 'full') { _this.hideStatus(); return; }

                if (!validated || !validated.length) {
                    _this.hideStatus();
                    Lampa.Noty.show('Нічого не знайдено або помилка відповіді AI');
                    if (window.ai_active_controller) Lampa.Controller.toggle(window.ai_active_controller); return;
                }

                validated.forEach(function (i) { window.ai_pagination.exclude_list.push(i.orig || i.uk); });

                _this.processAiList(validated, function (results) {
                    _this.hideStatus();
                    if (Lampa.Activity.active() && Lampa.Activity.active().component !== 'full') return;

                    if (!results.length) {
                        Lampa.Noty.show('Нічого не знайдено в базі TMDB');
                        if (window.ai_active_controller) Lampa.Controller.toggle(window.ai_active_controller); return;
                    }

                    if (cacheAction && card && card.id) _this.cacheSet(cacheAction, card.id, results);

                    window.ai_cached_results = results.slice();
                    window.ai_cached_results.push({ id:'ai_load_more', is_load_more:true, name:'',
                        poster:'https://bodya-elven.github.io/different/icons/more.webp',
                        img:'https://bodya-elven.github.io/different/icons/more.webp' });

                    Lampa.Activity.push({ url:'ai_assistant_list', title:title, component:'category_full', source:'ai_assistant_list', page:1 });
                    setTimeout(function () { _this.preloadNextPage(); }, 1000);
                });

            }, function () {
                _this.hideStatus();
                Lampa.Noty.show('Помилка з\'єднання з AI');
                if (window.ai_active_controller) Lampa.Controller.toggle(window.ai_active_controller);
            });
        };

        this.fetchNextPageData = function (callback, isSilent) {
            var limit      = Lampa.Storage.get(SK.result_count, '20');
            var exclusions = window.ai_pagination.exclude_list.slice(-50).join(', ');
            var p = window.ai_pagination.base_prompt +
                '\nВАЖЛИВО: виключи вже показані назви: ' + exclusions +
                '\nЗапропонуй рівно ' + limit + ' НОВИХ варіантів.' +
                '\nПоверни ТІЛЬКИ валідний JSON масив. Без markdown.';

            _this.request(p, function (text) {
                var list      = _this.parseJsonSafe(text);
                var validated = _this.applyContract(list, 'recommendation');
                if (!validated || !validated.length) { callback(null, null); return; }
                _this.processAiList(validated, function (results) { callback(validated, results); });
            }, function () { callback(null, null); }, { isSilent: !!isSilent });
        };

        this.preloadNextPage = function () {
            if (window.ai_pagination.is_preloading) return;
            window.ai_pagination.is_preloading = true;
            _this.fetchNextPageData(function (list, results) {
                if (results && results.length) {
                    window.ai_pagination.preloaded_results  = results;
                    window.ai_pagination.preloaded_raw_list = list;
                }
                window.ai_pagination.is_preloading = false;
            }, true);
        };

        this.loadMore = function (activeActivity) {
            if (window.ai_pagination.is_loading) return;
            window.ai_active_controller = Lampa.Controller.enabled().name;

            var renderResults = function (results, rawList) {
                rawList.forEach(function (i) { window.ai_pagination.exclude_list.push(i.orig || i.uk); });
                window.ai_pagination.preloaded_results  = null;
                window.ai_pagination.preloaded_raw_list = null;
                window.ai_pagination.is_loading         = false;
                _this.hideStatus();

                if (!results.length) {
                    Lampa.Noty.show('Більше нічого не знайдено');
                    if (window.ai_active_controller) Lampa.Controller.toggle(window.ai_active_controller); return;
                }

                window.ai_cached_results = window.ai_cached_results.filter(function (r) { return !r.is_load_more; });
                window.ai_cached_results = window.ai_cached_results.concat(results);
                window.ai_cached_results.push({ id:'ai_load_more', is_load_more:true, name:'',
                    poster:'https://bodya-elven.github.io/different/icons/more.webp',
                    img:'https://bodya-elven.github.io/different/icons/more.webp' });

                if (activeActivity && activeActivity.activity) {
                    var act   = activeActivity.activity;
                    var rnder = act.render();
                    rnder.find('.item[data-id="ai_load_more"]').remove();
                    var toAppend = results.slice();
                    toAppend.push({ id:'ai_load_more', is_load_more:true, name:'',
                        poster:'https://bodya-elven.github.io/different/icons/more.webp',
                        img:'https://bodya-elven.github.io/different/icons/more.webp' });
                    if (act.append) {
                        act.append(toAppend);
                        setTimeout(function () {
                            var cf = rnder.find('.item[data-id="' + results[0].id + '"]');
                            if (cf.length) Lampa.Controller.collectionFocus(cf[0], rnder[0]);
                        }, 100);
                    } else {
                        Lampa.Activity.replace({ url:'ai_assistant_list', title:activeActivity.title, component:'category_full', source:'ai_assistant_list', page:1 });
                    }
                }
                setTimeout(function () { _this.preloadNextPage(); }, 1000);
            };

            if (window.ai_pagination.preloaded_results) {
                window.ai_pagination.is_loading = true;
                renderResults(window.ai_pagination.preloaded_results, window.ai_pagination.preloaded_raw_list);
            } else if (window.ai_pagination.is_preloading) {
                window.ai_pagination.is_loading = true;
                _this.updateStatus('Підбір результатів...');
                var waitInterval = setInterval(function () {
                    if (window.ai_pagination.preloaded_results) {
                        clearInterval(waitInterval);
                        renderResults(window.ai_pagination.preloaded_results, window.ai_pagination.preloaded_raw_list);
                    } else if (!window.ai_pagination.is_preloading) {
                        clearInterval(waitInterval);
                        window.ai_pagination.is_loading = false;
                        _this.hideStatus();
                        Lampa.Noty.show('Помилка підбору — спробуйте ще раз');
                        if (window.ai_active_controller) Lampa.Controller.toggle(window.ai_active_controller);
                    }
                }, 500);
            } else {
                window.ai_pagination.is_loading = true;
                _this.updateStatus('Підбір результатів...');
                _this.fetchNextPageData(function (list, results) {
                    if (results && results.length) renderResults(results, list);
                    else {
                        window.ai_pagination.is_loading = false;
                        _this.hideStatus();
                        Lampa.Noty.show('Нічого не знайдено');
                        if (window.ai_active_controller) Lampa.Controller.toggle(window.ai_active_controller);
                    }
                }, false);
            }
        };

        // ───────────────────────────────────────────────────────────────
        //  UI HELPERS
        // ───────────────────────────────────────────────────────────────

        this.getSafeDynamicColor = function () {
            var raw = getComputedStyle(document.documentElement).getPropertyValue('--main-color').trim();
            if (!raw) return '#ffffff';
            var r = 0, g = 0, b = 0;
            if (raw.indexOf('#') === 0) {
                var hex = raw.slice(1);
                if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
                r = parseInt(hex.slice(0,2),16); g = parseInt(hex.slice(2,4),16); b = parseInt(hex.slice(4,6),16);
            } else if (raw.indexOf('rgb') === 0) {
                var m = raw.match(/\d+/g);
                if (m) { r = parseInt(m[0]); g = parseInt(m[1]); b = parseInt(m[2]); }
            } else { return raw; }
            r/=255; g/=255; b/=255;
            var max=Math.max(r,g,b), min=Math.min(r,g,b), h=0, s=0, l=(max+min)/2;
            if (max !== min) {
                var d=max-min;
                s = l>0.5 ? d/(2-max-min) : d/(max+min);
                switch(max){
                    case r: h=(g-b)/d+(g<b?6:0); break;
                    case g: h=(b-r)/d+2; break;
                    case b: h=(r-g)/d+4; break;
                }
                h/=6;
            }
            if (l<0.35) l=0.35;
            return 'hsl('+Math.round(h*360)+','+Math.round(s*100)+'%,'+Math.round(l*100)+'%)';
        };

        this.showViewer = function (title, contentHtml, btnElement, renderContainer, controllerName) {
            var safeColor = _this.getSafeDynamicColor();
            var fontSize  = Lampa.Storage.get(SK.font_size, '1.2em');
            var viewer = $('<div class="ai-viewer-container" style="--safe-text-color:' + safeColor + ';--ai-font-size:' + fontSize + ';">' +
                '<div class="ai-viewer-body">' +
                '<div class="ai-header"><div class="ai-title">' + title + '</div>' +
                '<div class="ai-close-btn selector">\xD7</div></div>' +
                '<div class="ai-content-scroll">' + contentHtml + '</div>' +
                '</div></div>');
            $('body').append(viewer);
            var close = function () { viewer.remove(); _this.restoreFocus(btnElement, renderContainer, controllerName); };
            viewer.find('.ai-close-btn').on('click hover:enter', close);
            Lampa.Controller.add('ai_viewer', {
                toggle: function () { Lampa.Controller.collectionSet(viewer); Lampa.Controller.collectionFocus(viewer.find('.ai-close-btn')[0], viewer); },
                up:   function () { viewer.find('.ai-content-scroll').scrollTop(viewer.find('.ai-content-scroll').scrollTop()-100); },
                down: function () { viewer.find('.ai-content-scroll').scrollTop(viewer.find('.ai-content-scroll').scrollTop()+100); },
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
            if (!ok) {
                Lampa.Noty.show('ШІ спить \uD83D\uDE34 Додайте API ключ у налаштуваннях');
                if (btn && render) _this.restoreFocus(btn, render, ctrl);
            }
            return ok;
        };

        this.restoreFocus = function (btnElement, renderContainer, controllerName) {
            if (Lampa.Activity.active() && Lampa.Activity.active().activity) {
                Lampa.Activity.active().activity.toggle();
            } else { Lampa.Controller.toggle(controllerName || 'full'); }
            if (!Lampa.Platform.is('touch') && btnElement && renderContainer) {
                setTimeout(function () { Lampa.Controller.collectionFocus(btnElement[0], renderContainer[0]); }, 10);
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
                '.ai-close-btn.focus{background:#fff;color:#000;outline:none;}' +
                '.ai-content-scroll{flex:1;overflow-y:auto;padding:10px 20px 20px 20px;color:#efefef;line-height:1.4;font-size:var(--ai-font-size,1.2em);}' +
                '.ai-fact-title{color:var(--safe-text-color,var(--main-color,#fff));font-weight:bold;display:block;margin-bottom:4px;}'
            ).appendTo('head');
        };
    }

    // ═══════════════════════════════════════════════════════════════════
    //  МАНІФЕСТ ТА ЗАПУСК
    // ═══════════════════════════════════════════════════════════════════

    var pluginManifest = {
        type: 'other', version: PLUGIN_VERSION,
        name: 'AI Асистент', description: 'Ваш персональний ШІ помічник',
        author: '@bodya_elven',
        icon: PLUGIN_ICON
    };

    if (Lampa.Manifest && Lampa.Manifest.plugins) Lampa.Manifest.plugins.ai_assistant = pluginManifest;

    if (!window.plugin_ai_assistant_instance) {
        window.plugin_ai_assistant_instance = new AIAssistantPlugin();
        if (window.appready) window.plugin_ai_assistant_instance.init();
        else Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') window.plugin_ai_assistant_instance.init();
        });
    }

})();
