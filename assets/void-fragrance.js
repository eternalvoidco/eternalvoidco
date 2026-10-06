// ─────────────────────────────────────────────────────────────────────────────
// /fragrance — NÉANT. Three chapters, six passages:
//
//   01 The Announcement     prologue · announcement
//   02 The Olfactory World  opening · heart · base
//   03 The Unveiling        the bottle, Coming Soon, the list
//
// Every change of passage is ONE timeline: the outgoing passage recedes, the
// room's light turns, the silhouette moves, the incoming words emerge — all
// Web Animations created in the same task and settled together. A new request
// at any moment freezes the running timeline where it stands (commitStyles)
// and starts the next one from there, so rapid or interrupted navigation never
// queues, jumps or leaves anything half-drawn. Resting states are plain CSS;
// when a timeline settles its animations are cancelled and nothing remains
// running except the slow reflection on the chapter 01 silhouette, which
// exists only while that chapter is shown and pauses with the page.
// ─────────────────────────────────────────────────────────────────────────────
(function () {
    'use strict';

    const root = document.documentElement;
    const $ = (id) => document.getElementById(id);

    // ── Words ────────────────────────────────────────────────────────────────
    // The storefront's own language choice (localStorage voidLanguage) and the
    // same four languages. German addresses the reader as "du", as the site does.
    const I18N = {
        en: {
            navCollection: '← Collection', navHouse: 'Eternal Void',
            ch1: 'The Announcement', ch2: 'The Olfactory World', ch3: 'The Unveiling', chapterWord: 'Chapter',
            mono1: 'Some presences are felt before they are seen.',
            mono2: 'They move through silence.',
            mono3: 'And remain after they have gone.',
            presents: 'Eternal Void presents',
            tagline: 'The void has a scent.',
            opening: 'Opening', heart: 'Heart', base: 'Base',
            openingTitle: 'First Light',
            openingCopy: 'A cold spark breaks the dark. Bergamot and blackcurrant sharpen the air; pink pepper flickers, and saffron draws a thread of gilded heat.',
            heartTitle: 'The Inner Chamber',
            heartCopy: 'Behind closed doors, rose and jasmine open in the half-light. Incense rises from smoked woods: slow, devotional, close.',
            baseTitle: 'What Remains',
            baseCopy: 'Oud and leather settle into the dark, softened by amber and vanilla. Patchouli and musk hold what is left: a presence, not a trace.',
            notesLabel: 'Notes',
            bergamot: 'Bergamot', blackcurrant: 'Blackcurrant', saffron: 'Saffron', pinkPepper: 'Pink pepper',
            rose: 'Rose', jasmine: 'Jasmine', incense: 'Incense', smokyWoods: 'Smoky woods',
            oud: 'Oud', amber: 'Amber', vanilla: 'Vanilla', leather: 'Leather', patchouli: 'Patchouli', musk: 'Musk',
            direction: 'Creative direction — the composition is still being refined.',
            unveilCopy: 'Composed in shadow and amber — the first fragrance of Eternal Void. Leave your address, and the unveiling will find you.',
            comingSoon: 'Coming Soon',
            emailLabel: 'Email address',
            submit: 'Receive the unveiling',
            sending: 'Sending…',
            success: 'You are on the list for the unveiling. Please check your email.',
            successNoMail: 'You are on the list for the unveiling.',
            invalid: 'Please enter a valid email address.',
            unavailable: 'Signup is not available right now. Please try again later.',
            failed: 'We could not sign you up just now. Please try again.',
            formNote: 'Occasional letters from Eternal Void. Unsubscribe at any time.',
            privacy: 'Privacy Policy',
            back: 'Back', next: 'Next', skip: 'Skip introduction', replay: 'Replay', progressLabel: 'Chapters',
            live: 'Chapter {n} of 3: {title}',
            bottleAlt: 'The NÉANT bottle: black faceted glass with a gold serpent coiled at the neck, amber extrait within.'
        },
        fr: {
            navCollection: '← Collection', navHouse: 'Eternal Void',
            ch1: 'L’Annonce', ch2: 'L’Univers olfactif', ch3: 'Le Dévoilement', chapterWord: 'Chapitre',
            mono1: 'Certaines présences se ressentent avant de se voir.',
            mono2: 'Elles traversent le silence.',
            mono3: 'Et demeurent, une fois parties.',
            presents: 'Eternal Void présente',
            tagline: 'Le néant a un parfum.',
            opening: 'Ouverture', heart: 'Cœur', base: 'Fond',
            openingTitle: 'Première lumière',
            openingCopy: 'Une étincelle froide fend l’obscurité. La bergamote et le cassis aiguisent l’air ; le poivre rose scintille, et le safran trace un fil de chaleur dorée.',
            heartTitle: 'La Chambre intérieure',
            heartCopy: 'Derrière des portes closes, la rose et le jasmin s’ouvrent dans la pénombre. L’encens s’élève des bois fumés, lent, recueilli, intime.',
            baseTitle: 'Ce qui demeure',
            baseCopy: 'L’oud et le cuir se posent dans l’ombre, adoucis par l’ambre et la vanille. Le patchouli et le musc retiennent ce qui reste : une présence, non une trace.',
            notesLabel: 'Notes',
            bergamot: 'Bergamote', blackcurrant: 'Cassis', saffron: 'Safran', pinkPepper: 'Poivre rose',
            rose: 'Rose', jasmine: 'Jasmin', incense: 'Encens', smokyWoods: 'Bois fumés',
            oud: 'Oud', amber: 'Ambre', vanilla: 'Vanille', leather: 'Cuir', patchouli: 'Patchouli', musk: 'Musc',
            direction: 'Direction créative — la composition est encore en cours d’affinage.',
            unveilCopy: 'Composé d’ombre et d’ambre — le premier parfum d’Eternal Void. Laissez votre adresse, et le dévoilement viendra à vous.',
            comingSoon: 'Bientôt',
            emailLabel: 'Adresse e-mail',
            submit: 'Recevoir le dévoilement',
            sending: 'Envoi…',
            success: 'Vous êtes sur la liste du dévoilement. Veuillez consulter vos e-mails.',
            successNoMail: 'Vous êtes sur la liste du dévoilement.',
            invalid: 'Veuillez saisir une adresse e-mail valide.',
            unavailable: 'L’inscription n’est pas disponible pour le moment. Veuillez réessayer plus tard.',
            failed: 'Nous n’avons pas pu vous inscrire pour le moment. Veuillez réessayer.',
            formNote: 'Des lettres occasionnelles d’Eternal Void. Désinscription à tout moment.',
            privacy: 'Politique de confidentialité',
            back: 'Retour', next: 'Suivant', skip: 'Passer l’introduction', replay: 'Revoir', progressLabel: 'Chapitres',
            live: 'Chapitre {n} sur 3 : {title}',
            bottleAlt: 'Le flacon NÉANT : verre noir facetté, serpent d’or enroulé au col, extrait ambré.'
        },
        it: {
            navCollection: '← Collezione', navHouse: 'Eternal Void',
            ch1: 'L’Annuncio', ch2: 'Il Mondo olfattivo', ch3: 'Lo Svelamento', chapterWord: 'Capitolo',
            mono1: 'Certe presenze si avvertono prima di vedersi.',
            mono2: 'Attraversano il silenzio.',
            mono3: 'E restano, anche dopo essersene andate.',
            presents: 'Eternal Void presenta',
            tagline: 'Il vuoto ha un profumo.',
            opening: 'Apertura', heart: 'Cuore', base: 'Fondo',
            openingTitle: 'Prima luce',
            openingCopy: 'Una scintilla fredda squarcia il buio. Bergamotto e ribes nero affilano l’aria; il pepe rosa vibra, e lo zafferano traccia un filo di calore dorato.',
            heartTitle: 'La Stanza interiore',
            heartCopy: 'Dietro porte chiuse, rosa e gelsomino si schiudono nella penombra. L’incenso sale dai legni affumicati: lento, devoto, vicino.',
            baseTitle: 'Ciò che resta',
            baseCopy: 'Oud e cuoio si posano nel buio, addolciti da ambra e vaniglia. Patchouli e muschio custodiscono ciò che resta: una presenza, non una traccia.',
            notesLabel: 'Note',
            bergamot: 'Bergamotto', blackcurrant: 'Ribes nero', saffron: 'Zafferano', pinkPepper: 'Pepe rosa',
            rose: 'Rosa', jasmine: 'Gelsomino', incense: 'Incenso', smokyWoods: 'Legni affumicati',
            oud: 'Oud', amber: 'Ambra', vanilla: 'Vaniglia', leather: 'Cuoio', patchouli: 'Patchouli', musk: 'Muschio',
            direction: 'Direzione creativa — la composizione è ancora in fase di definizione.',
            unveilCopy: 'Composta di ombra e ambra — la prima fragranza di Eternal Void. Lascia il tuo indirizzo, e lo svelamento verrà da te.',
            comingSoon: 'Prossimamente',
            emailLabel: 'Indirizzo email',
            submit: 'Ricevi lo svelamento',
            sending: 'Invio…',
            success: 'Sei nella lista per lo svelamento. Controlla la tua email.',
            successNoMail: 'Sei nella lista per lo svelamento.',
            invalid: 'Inserisci un indirizzo email valido.',
            unavailable: 'L’iscrizione non è disponibile al momento. Riprova più tardi.',
            failed: 'Non è stato possibile iscriverti ora. Riprova.',
            formNote: 'Lettere occasionali da Eternal Void. Puoi annullare l’iscrizione in qualsiasi momento.',
            privacy: 'Informativa sulla privacy',
            back: 'Indietro', next: 'Avanti', skip: 'Salta l’introduzione', replay: 'Rivedi', progressLabel: 'Capitoli',
            live: 'Capitolo {n} di 3: {title}',
            bottleAlt: 'Il flacone NÉANT: vetro nero sfaccettato, un serpente d’oro avvolto al collo, estratto ambrato.'
        },
        de: {
            navCollection: '← Kollektion', navHouse: 'Eternal Void',
            ch1: 'Die Ankündigung', ch2: 'Die Duftwelt', ch3: 'Die Enthüllung', chapterWord: 'Kapitel',
            mono1: 'Manche Gegenwart spürt man, bevor man sie sieht.',
            mono2: 'Sie bewegt sich durch die Stille.',
            mono3: 'Und bleibt, wenn sie gegangen ist.',
            presents: 'Eternal Void präsentiert',
            tagline: 'Die Leere hat einen Duft.',
            opening: 'Auftakt', heart: 'Herz', base: 'Basis',
            openingTitle: 'Erstes Licht',
            openingCopy: 'Ein kalter Funke bricht das Dunkel. Bergamotte und Schwarze Johannisbeere schärfen die Luft; rosa Pfeffer flackert, und Safran zieht einen Faden vergoldeter Wärme.',
            heartTitle: 'Die innere Kammer',
            heartCopy: 'Hinter verschlossenen Türen öffnen sich Rose und Jasmin im Halbdunkel. Weihrauch steigt aus rauchigen Hölzern: langsam, andächtig, nah.',
            baseTitle: 'Was bleibt',
            baseCopy: 'Oud und Leder senken sich ins Dunkel, gemildert von Amber und Vanille. Patchouli und Moschus halten, was bleibt: eine Gegenwart, keine Spur.',
            notesLabel: 'Noten',
            bergamot: 'Bergamotte', blackcurrant: 'Schwarze Johannisbeere', saffron: 'Safran', pinkPepper: 'Rosa Pfeffer',
            rose: 'Rose', jasmine: 'Jasmin', incense: 'Weihrauch', smokyWoods: 'Rauchige Hölzer',
            oud: 'Oud', amber: 'Amber', vanilla: 'Vanille', leather: 'Leder', patchouli: 'Patchouli', musk: 'Moschus',
            direction: 'Kreative Richtung — die Komposition wird noch verfeinert.',
            unveilCopy: 'Komponiert aus Schatten und Amber — der erste Duft von Eternal Void. Hinterlass deine Adresse, und die Enthüllung findet dich.',
            comingSoon: 'Demnächst',
            emailLabel: 'E-Mail-Adresse',
            submit: 'Die Enthüllung erhalten',
            sending: 'Wird gesendet…',
            success: 'Du stehst auf der Liste für die Enthüllung. Bitte prüfe deine E-Mails.',
            successNoMail: 'Du stehst auf der Liste für die Enthüllung.',
            invalid: 'Bitte gib eine gültige E-Mail-Adresse ein.',
            unavailable: 'Die Anmeldung ist gerade nicht verfügbar. Bitte versuche es später erneut.',
            failed: 'Die Anmeldung hat gerade nicht geklappt. Bitte versuche es erneut.',
            formNote: 'Gelegentliche Briefe von Eternal Void. Abmeldung jederzeit möglich.',
            privacy: 'Datenschutzerklärung',
            back: 'Zurück', next: 'Weiter', skip: 'Intro überspringen', replay: 'Erneut ansehen', progressLabel: 'Kapitel',
            live: 'Kapitel {n} von 3: {title}',
            bottleAlt: 'Der NÉANT-Flakon: schwarzes, facettiertes Glas, eine goldene Schlange um den Hals gewunden, bernsteinfarbenes Extrait.'
        }
    };

    let lang = 'en';
    try {
        const saved = localStorage.getItem('voidLanguage');
        if (saved && I18N[saved]) lang = saved;
    } catch (e) { /* storage blocked */ }
    const t = (key) => (I18N[lang] && I18N[lang][key]) || I18N.en[key] || '';

    function applyLanguage() {
        root.lang = lang;
        document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
        document.querySelectorAll('[data-i18n-alt]').forEach((el) => { el.alt = t(el.dataset.i18nAlt); });
        document.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
            el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel));
        });
    }

    // ── The passages ─────────────────────────────────────────────────────────
    const STEPS = [
        { id: 'prologue', chapter: 1 },
        { id: 'announcement', chapter: 1 },
        { id: 'opening', chapter: 2, sub: 'opening' },
        { id: 'heart', chapter: 2, sub: 'heart' },
        { id: 'base', chapter: 2, sub: 'base' },
        { id: 'unveiling', chapter: 3 }
    ];
    const LAST = STEPS.length - 1;
    const CHAPTERS = { 1: [0, 1], 2: [2, 3, 4], 3: [5] };

    // The room's light for each passage, by layer.
    const LIGHTS = {
        gold:   [0.42, 0.9, 0.3, 0.14, 0.16, 0.55],
        citrus: [0, 0, 1, 0, 0, 0],
        rose:   [0, 0, 0, 1, 0, 0],
        smoke:  [0, 0, 0, 0, 1, 0.25],
        amber:  [0, 0.5, 0.1, 0.4, 0.6, 0.95]
    };

    const EASE = {
        arrive: 'cubic-bezier(0.4, 0, 0.2, 1)',
        recede: 'cubic-bezier(0.5, 0, 0.3, 1)',
        settle: 'cubic-bezier(0.16, 1, 0.3, 1)',
        mech: 'cubic-bezier(0.45, 0, 0.25, 1)'
    };

    const scenes = STEPS.map((s) => $(s.id));
    const ghost = $('ntGhost');
    const lights = Array.from(document.querySelectorAll('[data-light]'));
    const backBtn = $('ntBack');
    const nextBtn = $('ntNext');
    const skipBtn = $('ntSkip');
    const replayBtn = $('ntReplay');
    const live = $('ntLive');
    const progressBtns = Array.from(document.querySelectorAll('.nt-progress [data-goto]'));

    if (scenes.some((s) => !s) || !ghost) return;

    const reduced = () => root.classList.contains('reduce-motion')
        || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let current = -1;   // the passage at rest
    let target = -1;    // the passage being shown (= current when at rest)
    let run = null;     // the timeline in flight
    let runSeq = 0;
    let autoAdvance = true;
    let autoTimer = null;
    let ghostBroken = false;

    // ── Splitting text for the letter reveal ─────────────────────────────────
    function split(el) {
        if (el.__ntText === undefined) el.__ntText = el.textContent;
        const text = el.__ntText;
        const words = [];
        const glyphs = [];
        const frag = document.createDocumentFragment();
        const seg = typeof Intl !== 'undefined' && Intl.Segmenter
            ? new Intl.Segmenter(lang, { granularity: 'grapheme' }) : null;
        text.split(/(\s+)/).forEach((chunk) => {
            if (!chunk) return;
            if (/^\s+$/.test(chunk)) { frag.appendChild(document.createTextNode(chunk)); return; }
            const w = document.createElement('span');
            w.className = 'nt-word';
            (seg ? Array.from(seg.segment(chunk), (x) => x.segment) : Array.from(chunk)).forEach((ch) => {
                const g = document.createElement('span');
                g.className = 'nt-glyph';
                g.textContent = ch;
                w.appendChild(g);
                glyphs.push(g);
            });
            words.push(w);
            frag.appendChild(w);
        });
        el.textContent = '';
        el.appendChild(frag);
        // The sentence stays one sentence for assistive technology.
        el.setAttribute('aria-label', text);
        return { words, glyphs };
    }

    function unsplit(el) {
        if (el.__ntText === undefined) return;
        el.textContent = el.__ntText;
        delete el.__ntText;
        el.removeAttribute('aria-label');
    }

    // Back to the resting page: no inline styles, whole text nodes.
    function resetScene(scene) {
        scene.removeAttribute('style');
        scene.querySelectorAll('[data-reveal]').forEach((el) => {
            unsplit(el);
            el.removeAttribute('style');
        });
        delete scene.dataset.revealed;
    }

    // ── Building one timeline ────────────────────────────────────────────────
    // A spec is { el, frames, delay, duration, easing }. Single-keyframe
    // frames animate from wherever the element currently is.
    function revealSpecs(scene, specs, base) {
        scene.querySelectorAll('[data-reveal]').forEach((el) => {
            const kind = el.dataset.reveal;
            const at = base + Number(el.dataset.at || 0);
            const ms = Number(el.dataset.ms || 0);
            const add = (frames, delay, duration, easing) => specs.push({ el, frames, delay, duration, easing });

            if (kind === 'glyphs') {
                const per = Number(el.dataset.per || 40);
                const glyphMs = Number(el.dataset.glyphMs || 760);
                const { words, glyphs } = split(el);
                glyphs.forEach((g, i) => add([{ opacity: 0 }, { opacity: 1 }], at + i * per, glyphMs, EASE.arrive));
                let seen = 0;
                words.forEach((w) => {
                    add([
                        { filter: 'blur(3px) drop-shadow(0 0 0px rgba(233, 211, 161, 0))' },
                        { filter: 'blur(1.7px) drop-shadow(0 0 10px rgba(233, 211, 161, 0.3))', offset: 0.4 },
                        { filter: 'blur(0.55px) drop-shadow(0 0 7px rgba(233, 211, 161, 0.18))', offset: 0.7 },
                        { filter: 'blur(0px) drop-shadow(0 0 0px rgba(233, 211, 161, 0))' }
                    ], at + seen * per, Math.max(900, glyphMs + 140), 'linear');
                    seen += w.childNodes.length;
                });
            } else if (kind === 'rise') {
                add([
                    { opacity: 0, transform: 'translate3d(0, 16px, 0)', filter: 'blur(3px)' },
                    { opacity: 1, transform: 'translate3d(0, 0, 0)', filter: 'blur(0px)' }
                ], at, ms || 950, EASE.settle);
            } else if (kind === 'fade') {
                const rest = parseFloat(getComputedStyle(el).opacity);
                add([{ opacity: 0 }, { opacity: Number.isFinite(rest) ? rest : 1 }], at, ms || 900, EASE.arrive);
            } else if (kind === 'rule') {
                add([
                    { opacity: 0, transform: 'scaleX(0)' },
                    { opacity: 1, transform: 'scaleX(1)' }
                ], at, ms || 1100, EASE.mech);
            } else if (kind === 'depth') {
                add([
                    { opacity: 0, transform: 'scale(1.14)', filter: 'blur(16px)' },
                    { opacity: 1, transform: 'scale(1)', filter: 'blur(0px)' }
                ], at, ms || 1900, EASE.arrive);
            } else if (kind === 'unveil') {
                add([{ opacity: 1 }, { opacity: 1, offset: 0.12 }, { opacity: 0 }], at, ms || 1800, EASE.arrive);
            } else if (kind === 'pass') {
                add([
                    { opacity: 0, backgroundPosition: '100% 0' },
                    { opacity: 1, offset: 0.3 },
                    { opacity: 1, offset: 0.7 },
                    { opacity: 0, backgroundPosition: '0% 0' }
                ], at, ms || 1500, EASE.mech);
            }
        });
    }

    // Reduced motion: each element simply fades in, close together. No
    // letters, no blur, nothing travels.
    function calmSpecs(scene, specs, base) {
        scene.querySelectorAll('[data-reveal]').forEach((el) => {
            const kind = el.dataset.reveal;
            if (kind === 'unveil' || kind === 'pass') return;
            const rest = parseFloat(getComputedStyle(el).opacity);
            specs.push({
                el,
                frames: [{ opacity: 0 }, { opacity: Number.isFinite(rest) ? rest : 1 }],
                delay: base,
                duration: 320,
                easing: 'ease'
            });
        });
    }

    function ghostState(step) {
        const wide = window.innerWidth > 960;
        if (step === 0) {
            return {
                box: { opacity: wide ? 1 : 0.55, transform: `translate3d(${wide ? Math.round(window.innerWidth * 0.17) : 0}px, 0, 0) scale(0.94)` },
                halo: 0.55, lit: 0, sweep: 0.5
            };
        }
        if (step === 1) {
            // Drawn back and lifted so the name crosses the foot of the glass,
            // below the bottle's own engraved label, never over it. Measured
            // from the title's real box, so it holds at any size or language.
            const S = 0.72;
            const H = ghost.offsetHeight;
            const top = ghost.offsetTop - H / 2;            // `translate: 0 -50%`
            const origin = top + H * 0.6;                   // transform-origin y
            const base = top + H * 0.9655;                  // where the glass ends
            const title = $('ntAnnounceTitle').getBoundingClientRect();
            const wantBase = title.height ? title.top + title.height * 0.62 : origin;
            const lift = Math.max(0, Math.round(origin + (base - origin) * S - wantBase));
            return { box: { opacity: 1, transform: `translate3d(0px, -${lift}px, 0) scale(${S})` }, halo: 1, lit: 0.6, sweep: 0.85 };
        }
        return null;
    }

    function ghostSpecs(to, specs, calm, initial) {
        if (ghostBroken) return;
        const state = ghostState(to);
        const halo = ghost.querySelector('.nt-ghost-halo');
        const lit = ghost.querySelector('.nt-ghost-lit');
        const sweep = ghost.querySelector('.nt-ghost-sweep');
        if (state) {
            if (ghost.hidden) {
                ghost.hidden = false;
                ghost.style.opacity = '0';
                ghost.style.transform = state.box.transform.replace(/scale\([^)]*\)/, 'scale(0.9)');
            }
            const long = calm ? 320 : (initial ? 2800 : 1800);
            specs.push({ el: ghost, frames: [state.box], delay: 0, duration: long, easing: EASE.arrive });
            specs.push({ el: halo, frames: [{ opacity: state.halo }], delay: 0, duration: long, easing: EASE.arrive });
            specs.push({ el: lit, frames: [{ opacity: state.lit }], delay: calm ? 0 : 300, duration: long, easing: EASE.arrive });
            specs.push({ el: sweep, frames: [{ opacity: state.sweep }], delay: 0, duration: long, easing: EASE.arrive });
        } else if (!ghost.hidden) {
            specs.push({ el: ghost, frames: [{ opacity: 0 }], delay: 0, duration: calm ? 240 : 900, easing: EASE.recede });
        }
    }

    function ghostRest(to) {
        const state = ghostState(to);
        if (!state || ghostBroken) {
            ghost.hidden = true;
            ghost.removeAttribute('style');
            ghost.querySelectorAll('[style]').forEach((el) => el.removeAttribute('style'));
            return;
        }
        ghost.style.opacity = String(state.box.opacity);
        ghost.style.transform = state.box.transform;
        ghost.querySelector('.nt-ghost-halo').style.opacity = String(state.halo);
        ghost.querySelector('.nt-ghost-lit').style.opacity = String(state.lit);
        ghost.querySelector('.nt-ghost-sweep').style.opacity = String(state.sweep);
    }

    // ── Running it ───────────────────────────────────────────────────────────
    function go(to, opts) {
        opts = opts || {};
        to = Math.max(0, Math.min(LAST, to));
        if (opts.user) stopAutoAdvance();
        clearTimeout(autoTimer);
        if (run && to === target) return;   // already on its way there
        if (run) freeze();
        if (to === current && to === target && !opts.initial) return;

        const from = target;
        const calm = reduced();
        const specs = [];
        target = to;

        // Out: every passage still showing, from wherever it stands.
        scenes.forEach((scene, i) => {
            if (i === to || scene.hidden) return;
            scene.inert = true;
            specs.push({
                el: scene,
                frames: calm ? [{ opacity: 0 }] : [{ opacity: 0, filter: 'blur(5px)', transform: 'scale(0.985)' }],
                delay: 0,
                duration: calm ? 220 : 720,
                easing: EASE.recede
            });
        });

        // In.
        const scene = scenes[to];
        if (!scene.hidden && scene.dataset.revealed === '1') {
            // Turned back while it was still leaving: it simply comes back.
            specs.push({
                el: scene,
                frames: [{ opacity: 1, filter: 'blur(0px)', transform: 'scale(1)' }],
                delay: 0,
                duration: calm ? 220 : 620,
                easing: EASE.settle
            });
        } else {
            resetScene(scene);
            scene.hidden = false;
            const base = opts.initial ? 250 : (calm ? 140 : 480);
            if (calm) calmSpecs(scene, specs, base); else revealSpecs(scene, specs, base);
        }
        scene.inert = false;

        // The light and the silhouette.
        lights.forEach((el) => {
            specs.push({
                el,
                frames: [{ opacity: LIGHTS[el.dataset.light][to] }],
                delay: 0,
                duration: calm ? 320 : (opts.initial ? 2600 : 1600),
                easing: EASE.arrive
            });
        });
        ghostSpecs(to, specs, calm, opts.initial);

        // Chapter 03 is a page that scrolls; the passages before it are not.
        const toPage = STEPS[to].chapter === 3;
        root.classList.toggle('nt-intro', !toPage);
        if (toPage && from !== to) window.scrollTo(0, 0);
        stage.setActive(false);

        updateChrome(to, opts);
        play(specs, to);
    }

    function play(specs, to) {
        const id = ++runSeq;
        const anims = specs.map((sp) => sp.el.animate(sp.frames, {
            delay: sp.delay,
            duration: sp.duration,
            easing: sp.easing || 'linear',
            fill: 'both'
        }));
        run = { id, anims, to };
        if (!anims.length) { settle(); return; }
        Promise.all(anims.map((a) => a.finished))
            .then(() => { if (run && run.id === id) settle(); })
            .catch(() => { /* cancelled by freeze(); the next run settles */ });
    }

    // Hold everything exactly where it is, as inline style, and let go of the
    // animations. The next timeline starts from here.
    function freeze() {
        const r = run;
        run = null;
        r.anims.forEach((a) => {
            try { a.commitStyles(); } catch (e) { /* not rendered */ }
            a.cancel();
        });
    }

    function settle() {
        const r = run;
        if (!r) return;
        run = null;
        const to = r.to;
        const wasPage = current !== -1 && STEPS[current].chapter === 3;

        // Resting state first, then release the animations, in one task, so
        // there is no frame where neither holds.
        scenes.forEach((scene, i) => {
            if (i === to) return;
            scene.hidden = true;
            scene.inert = false;
            resetScene(scene);
        });
        lights.forEach((el) => { el.style.opacity = String(LIGHTS[el.dataset.light][to]); });
        ghostRest(to);
        r.anims.forEach((a) => a.cancel());
        resetScene(scenes[to]);
        scenes[to].dataset.revealed = '1';
        current = to;

        if (wasPage && STEPS[to].chapter !== 3) window.scrollTo(0, 0);
        stage.setActive(STEPS[to].chapter === 3);
        scheduleAutoAdvance();
    }

    // Land at rest immediately (the page is being left or hidden).
    function settleNow() {
        if (!run) return;
        run.anims.forEach((a) => { try { a.finish(); } catch (e) { /* ignore */ } });
        settle();
    }

    // The monologue flows once into the announcement, unless the visitor has
    // already taken the controls. Nothing else ever moves on by itself.
    function scheduleAutoAdvance() {
        clearTimeout(autoTimer);
        if (!autoAdvance || current !== 0 || reduced() || document.hidden) return;
        autoTimer = setTimeout(() => {
            if (autoAdvance && current === 0 && !run) go(1, { auto: true });
        }, 2200);
    }

    function stopAutoAdvance() {
        autoAdvance = false;
        clearTimeout(autoTimer);
    }

    // ── Controls, progress, address bar, announcement ─────────────────────────
    function updateChrome(to, opts) {
        const step = STEPS[to];
        // Read before any control is hidden: hiding a focused element blurs it.
        const hadFocus = document.activeElement;
        document.body.dataset.step = String(to);
        backBtn.disabled = to === 0;
        nextBtn.hidden = to === LAST;
        skipBtn.hidden = to === LAST;
        replayBtn.hidden = to !== LAST;

        progressBtns.forEach((btn) => {
            const chapter = STEPS[Number(btn.dataset.goto)].chapter;
            const members = CHAPTERS[chapter];
            let fill = 0;
            if (chapter < step.chapter) fill = 1;
            else if (chapter === step.chapter) fill = (members.indexOf(to) + 1) / members.length;
            btn.querySelector('.nt-progress-bar i').style.setProperty('--fill', String(fill));
            if (chapter === step.chapter) btn.setAttribute('aria-current', 'step');
            else btn.removeAttribute('aria-current');
        });

        if (!opts.initial || location.hash) {
            try { history.replaceState(history.state, '', `#${step.id}`); } catch (e) { /* ignore */ }
        }

        let title = t(`ch${step.chapter}`);
        if (step.sub) title += ` — ${t(step.sub)}`;
        if (!opts.initial) live.textContent = t('live').replace('{n}', String(step.chapter)).replace('{title}', title);

        // Keep focus somewhere sensible when the control that had it goes away.
        const active = hadFocus;
        if (active && active !== document.body
            && (active.hidden || active.disabled || (active.closest && active.closest('[hidden]')))) {
            if (to === LAST) focusQuietly($('ntUnveilTitle'));
            else focusQuietly(nextBtn);
        }
    }

    function focusQuietly(el) {
        if (!el) return;
        if (!el.hasAttribute('tabindex') && !/^(A|BUTTON|INPUT)$/.test(el.tagName)) el.setAttribute('tabindex', '-1');
        try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
    }

    const next = () => { if (target < LAST) go(target + 1, { user: true }); };
    const back = () => { if (target > 0) go(target - 1, { user: true }); };
    const skip = () => go(LAST, { user: true });

    backBtn.addEventListener('click', back);
    nextBtn.addEventListener('click', next);
    skipBtn.addEventListener('click', skip);
    replayBtn.addEventListener('click', () => {
        autoAdvance = true;
        go(0, { replay: true });
        focusQuietly(nextBtn);
    });
    progressBtns.forEach((btn) => btn.addEventListener('click', () => go(Number(btn.dataset.goto), { user: true })));

    const inIntro = () => target < LAST;

    document.addEventListener('keydown', (e) => {
        if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
        const el = e.target;
        if (el && el.closest && el.closest('input, textarea, select, [contenteditable="true"]')) return;
        if (!inIntro()) return;   // chapter 03 scrolls like any page
        const onControl = el && el.closest && el.closest('button, a');
        switch (e.key) {
            case 'ArrowRight': case 'ArrowDown': case 'PageDown':
                e.preventDefault(); next(); break;
            case ' ':
                if (onControl) return;
                e.preventDefault(); next(); break;
            case 'ArrowLeft': case 'ArrowUp': case 'PageUp':
                e.preventDefault(); back(); break;
            case 'Home':
                e.preventDefault(); go(0, { user: true }); break;
            case 'End': case 'Escape':
                e.preventDefault(); skip(); break;
            default:
        }
    });

    // A deliberate scroll gesture moves one passage; a trackpad's momentum
    // tail cannot fire a second.
    let wheelSum = 0;
    let wheelIdle = null;
    let wheelLock = 0;
    window.addEventListener('wheel', (e) => {
        if (!inIntro() || e.ctrlKey) return;
        wheelSum += e.deltaY;
        clearTimeout(wheelIdle);
        wheelIdle = setTimeout(() => { wheelSum = 0; }, 220);
        const now = performance.now();
        if (now < wheelLock || Math.abs(wheelSum) < 60) return;
        wheelLock = now + 1100;
        const dir = wheelSum > 0 ? 1 : -1;
        wheelSum = 0;
        if (dir > 0) next(); else back();
    }, { passive: true });

    let touch = null;
    window.addEventListener('touchstart', (e) => {
        if (!inIntro() || e.touches.length !== 1) { touch = null; return; }
        if (e.target.closest && e.target.closest('.nt-controls, a, button, input')) { touch = null; return; }
        touch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }, { passive: true });
    window.addEventListener('touchend', (e) => {
        if (!touch || !inIntro()) return;
        const p = e.changedTouches[0];
        const dx = p.clientX - touch.x;
        const dy = p.clientY - touch.y;
        touch = null;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 56) return;
        const forward = Math.abs(dx) > Math.abs(dy) ? dx < 0 : dy < 0;
        if (forward) next(); else back();
    }, { passive: true });

    // ── Leaving or hiding the page stops every effect ─────────────────────────
    function pause() {
        root.classList.add('nt-paused');
        settleNow();
        clearTimeout(autoTimer);
        stage.setActive(false);
    }
    function resume() {
        root.classList.remove('nt-paused');
        if (current === LAST) stage.setActive(true);
        scheduleAutoAdvance();
    }
    document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); else resume(); });
    window.addEventListener('pagehide', pause);
    window.addEventListener('pageshow', (e) => { if (e.persisted) resume(); });

    window.addEventListener('resize', () => {
        if (!run && current <= 1 && current >= 0 && !ghost.hidden) ghostRest(current);
    });

    // ── Chapter 03 · the bottle stage ────────────────────────────────────────
    const stage = (function bottleStage() {
        const el = $('frStage');
        const img = $('ntBottleImg');
        if (img) {
            const missing = () => { if (el) el.dataset.missing = ''; };
            img.addEventListener('error', missing);
            if (img.complete && img.naturalWidth === 0 && img.currentSrc) missing();
        }
        const readVar = (name, fallback) => {
            const v = parseFloat(getComputedStyle(root).getPropertyValue(name));
            return Number.isFinite(v) ? v : fallback;
        };
        const DAMPING = readVar('--fr-damping', 0.055);
        const RELEASE = readVar('--fr-release-damping', 0.035);
        const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
        let tx = 0, ty = 0, ta = 0, cx = 0, cy = 0, ca = 0;
        let raf = null;
        let active = false;

        const write = () => {
            root.style.setProperty('--fr-px', cx.toFixed(4));
            root.style.setProperty('--fr-py', cy.toFixed(4));
            root.style.setProperty('--fr-active', ca.toFixed(4));
        };

        function frame() {
            raf = null;
            if (!active) return;
            const d = ta > 0 ? DAMPING : RELEASE;
            cx += (tx - cx) * d;
            cy += (ty - cy) * d;
            ca += (ta - ca) * 0.06;
            write();
            if (Math.abs(tx - cx) < 0.0005 && Math.abs(ty - cy) < 0.0005 && Math.abs(ta - ca) < 0.0005) return;
            raf = requestAnimationFrame(frame);
        }
        const kick = () => { if (active && !raf && !reduced() && !document.hidden) raf = requestAnimationFrame(frame); };

        function onMove(e) {
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height) return;
            tx = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width - 0.5) * 2));
            ty = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height - 0.5) * 2));
            ta = 1;
            kick();
        }
        function onLeave() { tx = 0; ty = 0; ta = 0; kick(); }

        return {
            setActive(on) {
                if (!el) return;
                on = Boolean(on) && fine.matches && !reduced();
                if (on === active) return;
                active = on;
                if (on) {
                    el.addEventListener('pointermove', onMove, { passive: true });
                    el.addEventListener('pointerleave', onLeave, { passive: true });
                } else {
                    el.removeEventListener('pointermove', onMove);
                    el.removeEventListener('pointerleave', onLeave);
                    if (raf) { cancelAnimationFrame(raf); raf = null; }
                    tx = ty = ta = cx = cy = ca = 0;
                    write();
                }
            },
            get running() { return raf !== null; }
        };
    })();

    ghost.querySelectorAll('img').forEach((img) => img.addEventListener('error', () => {
        ghostBroken = true;
        ghost.hidden = true;
    }));

    // ── The list ─────────────────────────────────────────────────────────────
    (function unveilingList() {
        const form = $('ntForm');
        const input = $('ntEmail');
        const submit = $('ntSubmit');
        const status = $('ntFormStatus');
        if (!form || !input || !submit || !status) return;
        const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        let sending = false;

        function setState(state, message) {
            if (state) form.dataset.state = state; else delete form.dataset.state;
            status.textContent = message || '';
        }

        input.addEventListener('input', () => {
            if (form.dataset.state === 'error') { setState(null, ''); input.removeAttribute('aria-invalid'); }
        });

        const phone = window.matchMedia('(max-width: 640px)');
        input.addEventListener('focus', () => { if (phone.matches) root.classList.add('nt-typing'); });
        input.addEventListener('blur', () => root.classList.remove('nt-typing'));

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (sending) return;
            const email = input.value.trim();
            if (!EMAIL_RE.test(email)) {
                input.setAttribute('aria-invalid', 'true');
                setState('error', t('invalid'));
                input.focus();
                return;
            }
            input.removeAttribute('aria-invalid');
            sending = true;
            submit.disabled = true;
            form.setAttribute('aria-busy', 'true');
            setState('sending', t('sending'));
            try {
                const res = await fetch('/api/newsletter', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                    body: JSON.stringify({ email, interest: 'neant' })
                });
                let data = null;
                try { data = await res.json(); } catch (err) { data = null; }
                if (res.ok && data && data.ok) {
                    setState('success', data.welcomeSent === false ? t('successNoMail') : t('success'));
                    root.classList.remove('nt-typing');
                    focusQuietly(status);
                    if (typeof window.gtag === 'function') window.gtag('event', 'sign_up', { method: 'neant_unveiling' });
                    return;
                }
                if (res.status === 400) {
                    input.setAttribute('aria-invalid', 'true');
                    setState('error', t('invalid'));
                } else if (res.status === 503) {
                    setState('error', t('unavailable'));
                } else {
                    setState('error', t('failed'));
                }
            } catch (err) {
                setState('error', t('failed'));
            } finally {
                sending = false;
                submit.disabled = false;
                form.removeAttribute('aria-busy');
            }
        });
    })();

    // ── Begin ────────────────────────────────────────────────────────────────
    applyLanguage();
    const fromHash = STEPS.findIndex((s) => `#${s.id}` === location.hash);
    if (fromHash > 0) autoAdvance = false;
    scenes.forEach((scene) => { scene.hidden = true; });
    go(fromHash >= 0 ? fromHash : 0, { initial: true });
    root.classList.add('nt-ready');

    // Read-only, for tests and debugging.
    window.__neant = {
        get step() { return current; },
        get target() { return target; },
        get busy() { return run !== null; },
        get stageRunning() { return stage.running; }
    };
})();
