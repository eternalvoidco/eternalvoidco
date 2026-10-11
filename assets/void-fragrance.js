// ─────────────────────────────────────────────────────────────────────────────
// /fragrance — NÉANT. A scroll-driven story on one pinned stage.
//
// The page's own scroll position is the timeline, measured in screens (s):
//
//   0    – 1.6   darkness; a narrow light discovers the crown, the glass
//                edges, then the silhouette. The poetry keeps its own time.
//   1.6  – 3.3   the light rises; at 2.35 the bottle and NÉANT arrive
//                together — one flash, light through the glass — and hold.
//   3.3  – 6.4   the olfactory world: opening, heart, base. The bottle
//                stands aside and each movement lights a part of it.
//   6.4  – 8.0   the construction: crown, glass, insignia and amber core
//                separate, hold, and come back together.
//   8.0  – 9.0   the bottle settles into the final scene as it scrolls in.
//
// Everything that is a function of position is computed from the scroll in
// frame(); only the poetry, the title's arrival and the flash run on a clock,
// and each is triggered by the scroll. Back/Next/Skip/Replay only ever move
// the scroll position, so the controls and the story cannot disagree. The
// rAF loop runs only while something is actually changing.
// ─────────────────────────────────────────────────────────────────────────────
(function () {
    'use strict';

    const root = document.documentElement;
    const $ = (id) => document.getElementById(id);

    // ── Words ────────────────────────────────────────────────────────────────
    // The storefront's own language choice (localStorage voidLanguage), in the
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
            constructionTitle: 'Four elements, one presence.',
            crown: 'The Crown', glass: 'The Glass', insignia: 'The Insignia', amberCore: 'The Amber Core',
            crownText: 'A faceted cap, set in gold',
            glassText: 'Shadowed glass, squared shoulders',
            insigniaText: 'The serpent and the V',
            amberCoreText: 'Where the light is held',
            discover: 'Discover the bottle',
            discoverHint: 'Move closer to discover',
            discoverHintTouch: 'Tap the bottle to discover',
            scrollHint: 'Scroll',
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
            constructionTitle: 'Quatre éléments, une seule présence.',
            crown: 'La Couronne', glass: 'Le Verre', insignia: 'L’Insigne', amberCore: 'Le Cœur d’ambre',
            crownText: 'Un bouchon à facettes, serti d’or',
            glassText: 'Un verre ombré, aux épaules carrées',
            insigniaText: 'Le serpent et le V',
            amberCoreText: 'Là où la lumière demeure',
            discover: 'Découvrir le flacon',
            discoverHint: 'Approchez pour découvrir',
            discoverHintTouch: 'Touchez le flacon pour découvrir',
            scrollHint: 'Défiler',
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
            constructionTitle: 'Quattro elementi, una sola presenza.',
            crown: 'La Corona', glass: 'Il Vetro', insignia: 'L’Insegna', amberCore: 'Il Cuore d’ambra',
            crownText: 'Un tappo sfaccettato, incastonato d’oro',
            glassText: 'Vetro in ombra, spalle squadrate',
            insigniaText: 'Il serpente e la V',
            amberCoreText: 'Dove la luce resta',
            discover: 'Scopri il flacone',
            discoverHint: 'Avvicinati per scoprire',
            discoverHintTouch: 'Tocca il flacone per scoprire',
            scrollHint: 'Scorri',
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
            constructionTitle: 'Vier Elemente, eine Gegenwart.',
            crown: 'Die Krone', glass: 'Das Glas', insignia: 'Das Insignium', amberCore: 'Der Bernsteinkern',
            crownText: 'Ein facettierter Verschluss, in Gold gefasst',
            glassText: 'Schattiertes Glas, kantige Schultern',
            insigniaText: 'Die Schlange und das V',
            amberCoreText: 'Wo das Licht verweilt',
            discover: 'Den Flakon entdecken',
            discoverHint: 'Komm näher, um zu entdecken',
            discoverHintTouch: 'Tippe auf den Flakon, um zu entdecken',
            scrollHint: 'Scrollen',
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

    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');

    function applyLanguage() {
        root.lang = lang;
        document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
        document.querySelectorAll('[data-i18n-alt]').forEach((el) => { el.alt = t(el.dataset.i18nAlt); });
        document.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
            el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel));
        });
        const hint = $('ntCaptionHint');
        if (hint) hint.textContent = t(finePointer.matches ? 'discoverHint' : 'discoverHintTouch');
    }

    // ── The story's geometry ────────────────────────────────────────────────
    const SCREENS = 9;   // = --nt-screens in the stylesheet
    const STOPS = [
        { id: 'prologue', s: 0, chapter: 1 },
        { id: 'announcement', s: 2.75, chapter: 1 },
        { id: 'opening', s: 3.85, chapter: 2 },
        { id: 'heart', s: 4.85, chapter: 2 },
        { id: 'base', s: 5.85, chapter: 2 },
        { id: 'construction', s: 7.35, chapter: 3 },
        { id: 'unveiling', s: SCREENS, chapter: 3 }
    ];
    const CHAPTERS = { 1: [0, 3.35], 2: [3.35, 6.4], 3: [6.4, SCREENS] };
    const CHAPTER_STOP = { 1: 0, 2: 2, 3: 5 };
    const REVEAL_AT = 2.35;

    // Where each part of the artwork is, as fractions of the bottle box.
    const SPOTS = {
        crown: { x: 0.5, y: 0.105, rx: 0.24, ry: 0.095 },
        insignia: { x: 0.5, y: 0.488, rx: 0.16, ry: 0.125 },
        amber: { x: 0.5, y: 0.805, rx: 0.26, ry: 0.085 },
        glass: { x: 0.25, y: 0.62, rx: 0.32, ry: 0.32 }
    };
    const TAP_ORDER = ['crown', 'insignia', 'amber', 'glass'];

    // ── Small maths ──────────────────────────────────────────────────────────
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const smooth = (x) => x * x * (3 - 2 * x);
    const easeOut = (x) => 1 - Math.pow(1 - x, 3);
    const mix = (a, b, k) => a + (b - a) * k;

    // Piecewise track: [[s, value], …], eased between points, held outside.
    function kf(points, s) {
        if (s <= points[0][0]) return points[0][1];
        for (let i = 1; i < points.length; i++) {
            const [s1, v1] = points[i];
            if (s <= s1) {
                const [s0, v0] = points[i - 1];
                return s1 === s0 ? v1 : mix(v0, v1, smooth((s - s0) / (s1 - s0)));
            }
        }
        return points[points.length - 1][1];
    }

    // ── Elements ─────────────────────────────────────────────────────────────
    const story = $('ntStory');
    const stage = $('ntStage');
    const bottle = $('ntBottle');
    const finalSection = $('unveiling');
    const anchor = $('ntAnchor');
    if (!story || !stage || !bottle || !finalSection || !anchor) return;

    const q = (sel) => bottle.querySelector(sel);
    const els = {
        halo: q('.nt-b-halo'),
        shape: q('.nt-b-shape'),
        art: q('.nt-b-art'),
        cap: q('.nt-b-cap'),
        ins: q('.nt-b-ins'),
        amber: q('.nt-b-amber'),
        glass: q('.nt-b-glass'),
        insGlow: q('.nt-b-ins .nt-b-glow'),
        amberGlow: q('.nt-b-amber .nt-b-glow'),
        hollowIns: q('.nt-b-hollow--ins'),
        hollowAmb: q('.nt-b-hollow--amb'),
        pass: q('.nt-b-pass'),
        passBand: q('.nt-b-pass i'),
        sheen: q('.nt-b-sheen'),
        spot: q('.nt-b-spot'),
        spotIn: q('.nt-b-spot-in'),
        flash: q('.nt-b-flash'),
        floor: q('.nt-b-floor'),
        parts: q('.nt-parts'),
        flashRoom: $('ntFlashRoom'),
        hint: $('ntHint')
    };
    const lights = {};
    document.querySelectorAll('[data-light]').forEach((el) => { lights[el.dataset.light] = el; });
    const beats = {};
    document.querySelectorAll('[data-beat]').forEach((el) => { beats[el.dataset.beat] = el; });
    const lines = Array.from(document.querySelectorAll('.nt-line[data-line]'));
    const announceKicker = document.querySelector('.nt-announce-kicker');
    const announceName = $('ntAnnounceName');
    const unveilCopy = $('ntUnveilCopy');
    const caption = $('ntCaption');
    const captionTitle = $('ntCaptionTitle');
    const captionText = $('ntCaptionText');
    const discover = $('ntDiscover');
    const backBtn = $('ntBack');
    const nextBtn = $('ntNext');
    const skipBtn = $('ntSkip');
    const replayBtn = $('ntReplay');
    const live = $('ntLive');
    const progressBtns = Array.from(document.querySelectorAll('.nt-progress [data-chapter]'));

    const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const calm = () => root.classList.contains('reduce-motion') || reducedQuery.matches;

    // Write a style only when it changes: most frames change little.
    function put(el, prop, value) {
        if (!el) return;
        const cache = el.__nt || (el.__nt = {});
        if (cache[prop] === value) return;
        cache[prop] = value;
        if (prop.startsWith('--')) el.style.setProperty(prop, value);
        else el.style[prop] = value;
    }
    const op = (v) => (Math.round(clamp(v, 0, 1) * 1000) / 1000).toString();
    const px = (v) => `${Math.round(v * 10) / 10}px`;

    // ── Measuring ────────────────────────────────────────────────────────────
    const geo = { vw: 0, vh: 0, bw: 0, bh: 0, top: 0, wide: true, final: { x: 0, y: 0, h: 0.7 } };

    function measure() {
        geo.vw = window.innerWidth;
        geo.vh = stage.clientHeight || window.innerHeight;
        geo.wide = geo.vw > 960;
        geo.bh = Math.round(geo.vh * 0.72);
        geo.bw = Math.round(geo.bh * 2 / 3);
        put(bottle, '--bw', `${geo.bw}px`);
        put(bottle, '--bh', `${geo.bh}px`);
        root.style.setProperty('--bw', `${geo.bw}px`);
        root.style.setProperty('--bh', `${geo.bh}px`);
        geo.top = story.getBoundingClientRect().top + window.scrollY;

        // Where the settled bottle stands: the final section's anchor, read
        // as it will be once that section has scrolled to the top.
        const f = finalSection.getBoundingClientRect();
        const a = anchor.getBoundingClientRect();
        const ax = a.left + a.width / 2;
        const ay = a.top - f.top + a.height / 2;
        const h = Math.min(a.height * 0.94, a.width * 1.5 * 0.94);
        geo.final = { x: (ax - geo.vw / 2) / geo.vw, y: (ay - geo.vh / 2) / geo.vh, h: h / geo.vh };
    }

    // Each composition of the bottle: offset from the stage centre (x as a
    // share of the width, y of the height) and box height (share of height).
    function pose(name) {
        const w = geo.wide;
        switch (name) {
            case 'dark': return w ? { x: 0.17, y: 0.02, h: 0.72 } : { x: 0, y: -0.03, h: 0.62 };
            case 'reveal': return w ? { x: 0, y: -0.075, h: 0.7 } : { x: 0, y: -0.1, h: 0.6 };
            case 'scent': return w ? { x: 0.25, y: 0.01, h: 0.66 } : { x: 0, y: 0.17, h: 0.62 };
            case 'parts': return w ? { x: 0, y: 0.03, h: 0.64 } : { x: 0, y: 0.04, h: 0.5 };
            default: return geo.final;
        }
    }

    const POSE_TRACK = [
        [0, 'dark'], [1.35, 'dark'], [2.2, 'reveal'], [3.15, 'reveal'],
        [3.75, 'scent'], [6.25, 'scent'], [6.8, 'parts'], [7.95, 'parts'], [8.95, 'final']
    ];

    function poseAt(s) {
        let i = 1;
        while (i < POSE_TRACK.length && s > POSE_TRACK[i][0]) i++;
        if (i >= POSE_TRACK.length) return pose('final');
        const [s0, n0] = POSE_TRACK[i - 1];
        const [s1, n1] = POSE_TRACK[i];
        const a = pose(n0);
        const b = pose(n1);
        const k = s <= s0 ? 0 : smooth(clamp((s - s0) / (s1 - s0), 0, 1));
        return { x: mix(a.x, b.x, k), y: mix(a.y, b.y, k), h: mix(a.h, b.h, k) };
    }

    // ── State ────────────────────────────────────────────────────────────────
    const state = {
        sTarget: 0,          // where the scroll is
        s: 0,                // where the story is (eased toward sTarget)
        last: 0,             // previous frame time
        t0: performance.now(),
        snapped: false,
        revealed: false,
        revealAt: -1e9,
        flashes: 0,
        lastFlash: -1e9,
        crossedUp: false,
        sepPeak: 0,
        pulseAt: -1e9,
        linesShown: [false, false, false],
        finalShown: false,
        scrolled: false,
        stop: -1,
        chapter: 0,
        endMode: null,
        lamp: { x: 0.5, y: 0.5, i: 0, tx: 0.5, ty: 0.5, ti: 0, key: '', tapIndex: -1 },
        raf: 0,
        running: false,
        paused: false,
        programmatic: null
    };

    function readScroll() {
        state.sTarget = clamp((window.scrollY - geo.top) / geo.vh, 0, SCREENS);
    }

    // ── Letter reveals (the house's language-transition style) ──────────────
    const ARRIVE = 'cubic-bezier(0.4, 0, 0.2, 1)';
    const SETTLE = 'cubic-bezier(0.16, 1, 0.3, 1)';
    const MECH = 'cubic-bezier(0.45, 0, 0.25, 1)';

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
        el.setAttribute('aria-label', text);
        return { words, glyphs };
    }

    function unsplit(el) {
        if (el.__ntText === undefined) return;
        el.textContent = el.__ntText;
        delete el.__ntText;
        el.removeAttribute('aria-label');
    }

    function revealTargets(scope) {
        return scope.matches('[data-reveal]') ? [scope] : Array.from(scope.querySelectorAll('[data-reveal]'));
    }

    // Show a scope: its [data-reveal] children arrive on one shared clock.
    // `instant` shows it at rest straight away (arriving by a jump, or calm).
    function reveal(scope, opts) {
        opts = opts || {};
        if (!scope || scope.classList.contains('is-shown')) return;
        stopReveal(scope);
        scope.classList.add('is-shown');
        if (opts.instant || calm()) return;
        const anims = [];
        const add = (el, frames, delay, duration, easing) => {
            anims.push(el.animate(frames, { delay, duration, easing: easing || 'linear', fill: 'both' }));
        };
        revealTargets(scope).forEach((el) => {
            const kind = el.dataset.reveal;
            const at = Number(el.dataset.at || 0);
            if (kind === 'glyphs') {
                const per = Number(el.dataset.per || 40);
                const glyphMs = Number(el.dataset.glyphMs || 760);
                const { words, glyphs } = split(el);
                glyphs.forEach((g, i) => add(g, [{ opacity: 0 }, { opacity: 1 }], at + i * per, glyphMs, ARRIVE));
                let seen = 0;
                // Display-size titles resolve from blur without the glint:
                // a drop-shadow on letters that large costs whole frames.
                const glint = el.dataset.glow !== '0';
                const glow = (blur, r, a) => (glint
                    ? `blur(${blur}px) drop-shadow(0 0 ${r}px rgba(233, 211, 161, ${a}))`
                    : `blur(${blur}px)`);
                words.forEach((w) => {
                    add(w, [
                        { filter: glow(3, 0, 0) },
                        { filter: glow(1.7, 10, 0.3), offset: 0.4 },
                        { filter: glow(0.55, 7, 0.18), offset: 0.7 },
                        { filter: glow(0, 0, 0) }
                    ], at + seen * per, Math.max(900, glyphMs + 140));
                    seen += w.childNodes.length;
                });
            } else if (kind === 'rise') {
                add(el, [
                    { opacity: 0, transform: 'translate3d(0, 14px, 0)', filter: 'blur(3px)' },
                    { opacity: 1, transform: 'translate3d(0, 0, 0)', filter: 'blur(0px)' }
                ], at, 950, SETTLE);
            } else if (kind === 'rule') {
                add(el, [{ opacity: 0, transform: 'scaleX(0)' }, { opacity: 1, transform: 'scaleX(1)' }], at, 1000, MECH);
            } else if (kind === 'depth') {
                add(el, [
                    { opacity: 0, transform: 'scale(1.14)', filter: 'blur(12px)' },
                    { opacity: 1, transform: 'scale(1)', filter: 'blur(0px)' }
                ], at, 1500, ARRIVE);
            } else {
                add(el, [{ opacity: 0 }, { opacity: 1 }], at, 900, ARRIVE);
            }
        });
        scope.__ntAnims = anims;
        Promise.all(anims.map((a) => a.finished)).then(() => {
            if (scope.__ntAnims !== anims) return;
            anims.forEach((a) => a.cancel());
            revealTargets(scope).forEach(unsplit);
            scope.__ntAnims = null;
        }).catch(() => { /* cancelled */ });
    }

    function stopReveal(scope) {
        if (scope.__ntAnims) scope.__ntAnims.forEach((a) => { try { a.cancel(); } catch (e) { /* ignore */ } });
        scope.__ntAnims = null;
        revealTargets(scope).forEach(unsplit);
    }

    function hide(scope) {
        if (!scope || !scope.classList.contains('is-shown')) return;
        stopReveal(scope);
        scope.classList.remove('is-shown');
    }

    // ── The flash ────────────────────────────────────────────────────────────
    // Lightning, not a strobe: a source above and behind the bottle strikes
    // twice and dies away. It lights only what light would reach — the glass
    // (the artwork, screened) and a warm falloff in the room — never the
    // whole frame, so the blacks stay black.
    function flash() {
        if (calm()) return;
        const now = performance.now();
        if (now - state.lastFlash < 3000) return;
        state.lastFlash = now;
        state.flashes += 1;
        const r = bottle.getBoundingClientRect();
        put(els.flashRoom, '--fx', px(r.left + r.width * 0.5));
        put(els.flashRoom, '--fy', px(r.top + r.height * 0.18));
        const strike = (peak) => [
            { opacity: 0 },
            { opacity: peak, offset: 0.045 },
            { opacity: peak * 0.22, offset: 0.12 },
            { opacity: peak * 0.86, offset: 0.19 },
            { opacity: peak * 0.16, offset: 0.36 },
            { opacity: peak * 0.3, offset: 0.44 },
            { opacity: 0 }
        ];
        els.flashRoom.animate(strike(1), { duration: 1150, easing: 'linear' });
        els.flash.animate(strike(0.78), { duration: 1150, easing: 'linear' });
    }

    // ── The decisive reveal ──────────────────────────────────────────────────
    function setRevealed(on, withFlash) {
        if (on === state.revealed) return;
        state.revealed = on;
        if (on) {
            const instant = !withFlash || calm();
            state.revealAt = instant ? -1e9 : performance.now();
            reveal(announceName, { instant });
            if (withFlash) flash();
        } else {
            hide(announceName);
        }
    }

    // ── One frame of the story ───────────────────────────────────────────────
    function frame(now) {
        const s = state.s;
        const time = (now - state.t0) / 1000;
        const isCalm = calm();
        const w = geo.wide;

        // Bottle placement.
        const p = poseAt(s);
        const revealK = clamp((now - state.revealAt) / 900, 0, 1);
        const arrive = kf([[1.5, 0], [1.8, 1], [3.1, 1], [3.4, 0]], s);
        let k = (p.h * geo.vh) / geo.bh;
        k *= 1 - 0.035 * arrive * (state.revealed ? 1 - easeOut(revealK) : 1);
        const lamp = state.lamp;
        let tilt = '';
        if (s >= SCREENS - 0.15 && lamp.i > 0.001 && !isCalm) {
            const ry = (lamp.x - 0.5) * 6 * lamp.i;
            const rx = -(lamp.y - 0.5) * 3.5 * lamp.i;
            tilt = ` perspective(1600px) rotateX(${rx.toFixed(3)}deg) rotateY(${ry.toFixed(3)}deg)`;
        }
        put(bottle, 'transform', `translate3d(${px(p.x * geo.vw)}, ${px(p.y * geo.vh)}, 0) scale(${k.toFixed(4)})${tilt}`);

        // Prologue: the light's own progress — scroll, or time if the
        // visitor simply waits in the dark.
        const pl = clamp(Math.max(s / 1.35, (time - 0.9) / 11), 0, 1);

        // Light levels.
        // On a phone the bottle stands behind the words, so it stays low.
        const scentLit = w ? 0.55 : 0.16;
        let lit = kf([[0, 0], [1.5, 0], [2.3, 0.5], [2.6, 1], [3.15, 1], [3.75, scentLit], [6.25, scentLit], [6.8, 0.92], [7.95, 0.92], [8.7, 1]], s);
        if (state.revealed && s < 3.4) lit = Math.max(lit, mix(0.5, 1, easeOut(revealK)));
        put(els.art, 'opacity', op(lit));

        const sep = isCalm
            ? (s >= 6.8 && s < 7.95 ? 1 : 0)
            : kf([[6.75, 0], [7.2, 1], [7.5, 1], [7.95, 0]], s);
        put(els.shape, 'opacity', op(1 - sep));

        const haloScroll = kf([[0, 0], [1.0, 0.12], [1.5, 0.6], [2.3, 1], [3.15, 0.9], [3.75, 0.5], [6.25, 0.5], [6.8, 0.7], [7.95, 0.7], [8.8, 0.6]], s);
        const haloTime = kf([[0, 0.04], [0.8, 0.12], [1, 0.6]], pl) * clamp((time - 0.4) / 1.6, 0, 1);
        put(els.halo, 'opacity', op(Math.max(haloScroll, s < 2 ? haloTime : 0)));

        put(els.floor, 'opacity', op(kf([[2.0, 0], [2.55, 0.65], [3.15, 0.65], [3.75, 0.2], [6.25, 0.2], [6.8, 0.35], [7.95, 0.35], [8.8, 1]], s)));

        // The construction: parts lift away along their own axes.
        const H = geo.bh;
        const W = geo.bw;
        // Small, believable distances: the crown lifts off its ring, the
        // insignia comes forward off the glass, the amber core sinks and
        // swells within the walls that hold it.
        put(els.cap, 'transform', `translate3d(0, ${px(-0.09 * H * sep)}, 0) rotate(${(-3 * sep).toFixed(3)}deg)`);
        put(els.ins, 'transform', `translate3d(${px(-0.11 * W * sep)}, ${px(-0.015 * H * sep)}, 0) scale(${(1 + 0.1 * sep).toFixed(4)})`);
        put(els.amber, 'transform', `translate3d(${px(0.05 * W * sep)}, ${px(0.035 * H * sep)}, 0) scale(${(1 + 0.12 * sep).toFixed(4)})`);
        put(els.glass, 'transform', `scale(${(1 - 0.02 * sep).toFixed(4)})`);
        put(els.hollowIns, 'opacity', op(sep * 0.92));
        put(els.hollowAmb, 'opacity', op(sep * 0.85));
        put(els.parts, 'opacity', op(isCalm ? sep : kf([[7.0, 0], [7.2, 1], [7.5, 1], [7.7, 0]], s)));

        // Reassembly: when the parts close (after having been fully open) the
        // light runs through the whole bottle once.
        if (sep > 0.95) state.sepPeak = 1;
        if (state.sepPeak && sep < 0.02 && s > 7.9 && !state.snapped && !isCalm) {
            state.sepPeak = 0;
            state.pulseAt = now;
        }
        if (s < 6.75) state.sepPeak = 0;
        const pulse = clamp((now - state.pulseAt) / 1400, 0, 1);
        const pulseOn = pulse < 1;
        const revealPass = state.revealed ? clamp((now - state.revealAt - 250) / 1300, 0, 1) : 1;

        // Light through the glass.
        let passPos = -1;
        let passOp = 0;
        if (pulseOn) { passPos = pulse; passOp = Math.sin(Math.PI * pulse) * 0.9; }
        else if (revealPass < 1 && !isCalm) { passPos = revealPass; passOp = Math.sin(Math.PI * revealPass) * 0.95; }
        else if (s > 1.85 && s < 2.5 && !isCalm) {
            const x = (s - 1.85) / 0.65;
            passPos = x; passOp = Math.sin(Math.PI * x) * 0.8;
        }
        put(els.pass, 'opacity', op(passOp));
        if (passPos >= 0) put(els.passBand, 'transform', `translate3d(${px(mix(-0.55, 1.1, passPos) * W)}, 0, 0) skewX(-12deg)`);

        // Amber core and insignia glows; the amber catches the passing light.
        const passOnAmber = passOp * Math.exp(-Math.pow((passPos - 0.45) / 0.18, 2));
        let amberGlow = kf([[1.95, 0], [2.35, 0.55], [2.6, 0.8], [3.15, 0.6], [3.75, 0.15], [5.3, 0.15], [5.6, 1], [6.1, 1], [6.35, 0.3], [7.95, 0.3], [8.8, 0.5]], s);
        amberGlow = Math.max(amberGlow, passOnAmber * 1.1);
        put(els.amberGlow, 'opacity', op(amberGlow));
        put(els.insGlow, 'opacity', op(kf([[4.3, 0], [4.6, 0.95], [5.1, 0.95], [5.4, 0]], s)));

        // The settled scene's slow reflection.
        put(els.sheen, 'opacity', op(kf([[8.4, 0], [8.95, 1]], s)));

        // The narrow light.
        spotFrame(s, pl, time, isCalm);

        // The room.
        put(lights.gold, 'opacity', op(kf([[0, 0.12], [1.2, 0.22], [2.3, 0.9], [3.2, 0.8], [3.7, 0.3], [6.3, 0.3], [6.8, 0.6], [8.0, 0.6], [8.8, 0.55]], s)));
        put(lights.citrus, 'opacity', op(kf([[3.3, 0], [3.6, 1], [4.1, 1], [4.45, 0]], s)));
        put(lights.rose, 'opacity', op(kf([[4.2, 0], [4.5, 1], [5.1, 1], [5.45, 0]], s)));
        put(lights.smoke, 'opacity', op(kf([[5.2, 0], [5.5, 1], [6.2, 1], [6.6, 0.2], [8.8, 0.25]], s)));
        put(lights.amber, 'opacity', op(kf([[1.8, 0], [2.4, 0.5], [3.2, 0.4], [3.7, 0.1], [5.3, 0.2], [5.6, 0.6], [6.3, 0.4], [8.0, 0.4], [8.8, 0.95]], s)));
        put(lights.haze, 'opacity', op(kf([[8.2, 0], [8.9, 1]], s)));
        root.classList.toggle('nt-final', s >= 8.6);

        beatsFrame(s, time, isCalm, now);
        lampFrame();
    }

    // The narrow light: where it is and what shape it has, in box pixels.
    function spotFrame(s, pl, time, isCalm) {
        const W = geo.bw;
        const H = geo.bh;
        let o = 0;
        let cx = 0.5, cy = 0.5, sw = 0.3, sh = 0.15, rot = 0;
        if (s < 1.8 && !isCalm) {
            // Crown → down the left edge → down the right edge.
            const P = [
                [0.00, 0.30, 0.09, 0.26, 0.12, -10],
                [0.30, 0.70, 0.11, 0.26, 0.12, 8],
                [0.38, 0.60, 0.25, 0.20, 0.12, 0],
                [0.48, 0.23, 0.40, 0.10, 0.22, 4],
                [0.66, 0.215, 0.86, 0.10, 0.22, 2],
                [0.72, 0.5, 0.62, 0.12, 0.2, 0],
                [0.76, 0.785, 0.40, 0.10, 0.22, -4],
                [0.94, 0.80, 0.86, 0.10, 0.22, -2],
                [1.00, 0.5, 0.6, 0.5, 0.5, 0]
            ];
            let i = 1;
            while (i < P.length - 1 && pl > P[i][0]) i++;
            const a = P[i - 1];
            const b = P[i];
            const k = smooth(clamp((pl - a[0]) / (b[0] - a[0]), 0, 1));
            cx = mix(a[1], b[1], k); cy = mix(a[2], b[2], k);
            sw = mix(a[3], b[3], k); sh = mix(a[4], b[4], k); rot = mix(a[5], b[5], k);
            // Never quite still: the light breathes and wanders a little.
            cx += Math.sin(time * 0.55) * 0.012;
            cy += Math.cos(time * 0.42) * 0.008;
            const intro = clamp((time - 0.9) / 1.3, 0, 1);
            const traverse = kf([[0.66, 1], [0.7, 0.12], [0.74, 0.12], [0.78, 1]], pl);
            const settle = kf([[0.92, 1], [1, 0.3]], pl);
            o = intro * traverse * settle * kf([[1.35, 1], [1.75, 0]], s);
        } else if (s > 3.35 && s < 4.4 && !isCalm && geo.wide) {
            // Opening: first light finds the crown.
            o = kf([[3.4, 0], [3.7, 0.85], [4.05, 0.85], [4.35, 0]], s);
            cx = mix(0.38, 0.62, clamp((s - 3.4) / 0.95, 0, 1)); cy = 0.1; sw = 0.42; sh = 0.17; rot = -6;
        } else if (s >= SCREENS - 0.15 && state.lamp.i > 0.002) {
            // Final scene: the visitor's own lamp.
            const l = state.lamp;
            o = l.i * 0.95; cx = l.x; cy = l.y; sw = 0.34; sh = 0.22; rot = 0;
        }
        const lampMode = s >= SCREENS - 0.15;
        if (lampMode !== els.spot.__lamp) { els.spot.__lamp = lampMode; els.spot.classList.toggle('is-lamp', lampMode); }
        put(els.spot, 'opacity', op(o));
        if (o <= 0.001) return;
        const S = W;
        const sx = Math.max(0.02, (sw * W) / S);
        const sy = Math.max(0.02, (sh * H) / S);
        const X = cx * W;
        const Y = cy * H;
        put(els.spot, 'transform', `translate(${px(X)}, ${px(Y)}) rotate(${rot.toFixed(2)}deg) scale(${sx.toFixed(4)}, ${sy.toFixed(4)}) translate(${px(-S / 2)}, ${px(-S / 2)})`);
        put(els.spotIn, 'transform', `translate(${px(S / 2)}, ${px(S / 2)}) scale(${(1 / sx).toFixed(4)}, ${(1 / sy).toFixed(4)}) rotate(${(-rot).toFixed(2)}deg) translate(${px(-X)}, ${px(-Y)})`);
    }

    // Text compositions: their visibility follows the scroll; their words
    // arrive on their own clock the first time each is reached.
    function beatsFrame(s, time, isCalm, now) {
        const show = (el, v, lift) => {
            put(el, 'opacity', op(v));
            if (!isCalm) put(el, 'transform', `translate3d(0, ${px((1 - v) * (lift || 18))}, 0)`);
        };

        // Prologue: each line when its moment comes — by time if the visitor
        // waits, sooner if they scroll.
        const pro = isCalm ? (s < 1.6 ? 1 : 0) : kf([[0, 1], [1.4, 1], [1.7, 0]], s);
        show(beats.prologue, pro, 0);
        const LINE_T = [1.6, 4.4, 7.2];
        const LINE_S = [0.02, 0.45, 0.9];
        lines.forEach((line, i) => {
            if (!state.linesShown[i] && (isCalm || time >= LINE_T[i] || s >= LINE_S[i])) {
                state.linesShown[i] = true;
                reveal(line, { instant: s > 1.4 });
            }
        });

        // The name: arrives once, decisively, at the threshold.
        show(beats.announcement, kf([[1.5, 0], [1.6, 1], [3.05, 1], [3.35, 0]], s), 0);
        // The kicker holds the name's place, then gives way to it.
        const named = state.revealed ? easeOut(clamp((now - state.revealAt) / 500, 0, 1)) : 0;
        put(announceKicker, 'opacity', op(kf([[1.55, 0], [1.9, 1]], s) * (1 - named)));
        if (!state.revealed && s >= REVEAL_AT && s < 3.4) setRevealed(true, state.crossedUp && !state.snapped);
        else if (state.revealed && (s < 2.15 || s > 3.6)) setRevealed(false);

        const accord = [
            ['opening', [[3.35, 0], [3.6, 1], [4.1, 1], [4.35, 0]]],
            ['heart', [[4.35, 0], [4.6, 1], [5.1, 1], [5.35, 0]]],
            ['base', [[5.35, 0], [5.6, 1], [6.1, 1], [6.35, 0]]],
            ['construction', [[6.45, 0], [6.75, 1], [7.75, 1], [8.0, 0]]]
        ];
        accord.forEach(([id, track]) => {
            const v = kf(track, s);
            show(beats[id], v);
            if (v >= 0.6) reveal(beats[id], { instant: state.snapped });
            else if (v <= 0.001) hide(beats[id]);
        });

        // The final copy, the first time the bottle begins to settle.
        if (!state.finalShown && s >= 8.3) {
            state.finalShown = true;
            reveal(unveilCopy);
        }

        // "Scroll", for a visitor who waits at the top.
        if (s > 0.05) state.scrolled = true;
        if (els.hint) els.hint.classList.toggle('is-on', !state.scrolled && time > 3.4 && s < 0.05);
    }

    // ── Hover and tap discovery (final scene) ───────────────────────────────
    function lampFrame() {
        const l = state.lamp;
        let key = '';
        if (l.i > 0.35) {
            key = 'glass';
            for (const name of ['crown', 'insignia', 'amber']) {
                const h = SPOTS[name];
                const dx = (l.x - h.x) / h.rx;
                const dy = (l.y - h.y) / h.ry;
                if (dx * dx + dy * dy <= 1) { key = name; break; }
            }
            if (key === 'glass' && (l.x < 0.16 || l.x > 0.84 || l.y < 0.32 || l.y > 0.97)) key = '';
        }
        if (key !== l.key) {
            l.key = key;
            const labelKey = key === 'amber' ? 'amberCore' : key;
            if (key) {
                captionTitle.textContent = t(labelKey);
                captionText.textContent = t(`${labelKey}Text`);
            }
            caption.classList.toggle('is-on', Boolean(key));
        }
    }

    function stepLamp(dt) {
        const l = state.lamp;
        const kp = 1 - Math.exp(-dt / 140);
        const ki = 1 - Math.exp(-dt / (l.ti > l.i ? 220 : 420));
        l.x += (l.tx - l.x) * kp;
        l.y += (l.ty - l.y) * kp;
        l.i += (l.ti - l.i) * ki;
        if (Math.abs(l.ti - l.i) < 0.002) l.i = l.ti;
        return Math.abs(l.tx - l.x) > 0.0008 || Math.abs(l.ty - l.y) > 0.0008 || l.i !== l.ti;
    }

    const atFinal = () => state.s >= SCREENS - 0.15;

    function boxPoint(clientX, clientY) {
        const r = bottle.getBoundingClientRect();
        return { x: (clientX - r.left) / r.width, y: (clientY - r.top) / r.height };
    }

    anchor.addEventListener('pointermove', (e) => {
        if (e.pointerType === 'touch' || !atFinal()) return;
        const b = boxPoint(e.clientX, e.clientY);
        const l = state.lamp;
        const near = b.x > -0.12 && b.x < 1.12 && b.y > -0.06 && b.y < 1.04;
        l.tx = clamp(b.x, 0.12, 0.88);
        l.ty = clamp(b.y, 0.05, 0.94);
        l.ti = near ? 1 : 0;
        l.tapIndex = -1;
        kick();
    }, { passive: true });

    anchor.addEventListener('pointerleave', (e) => {
        if (e.pointerType === 'touch') return;
        state.lamp.ti = 0;
        kick();
    });

    // Touch and keyboard: each tap lights the next part, then rests.
    let lastPointer = '';
    discover.addEventListener('pointerdown', (e) => { lastPointer = e.pointerType; });
    discover.addEventListener('click', (e) => {
        const viaMouse = lastPointer === 'mouse' && e.detail > 0;
        lastPointer = '';
        if (viaMouse) return;   // the pointer itself is the lamp
        const l = state.lamp;
        l.tapIndex = l.tapIndex + 1 >= TAP_ORDER.length ? -1 : l.tapIndex + 1;
        if (l.tapIndex < 0) { l.ti = 0; } else {
            const h = SPOTS[TAP_ORDER[l.tapIndex]];
            l.tx = h.x; l.ty = h.y; l.ti = 1;
            if (l.i < 0.05) { l.x = h.x; l.y = h.y; }
        }
        kick();
    });

    // ── The loop ─────────────────────────────────────────────────────────────
    function tick(now) {
        state.raf = 0;
        if (state.paused) { state.running = false; return; }
        const dt = Math.min(64, now - (state.last || now));
        state.last = now;

        const prev = state.s;
        const gap = state.sTarget - state.s;
        state.snapped = Math.abs(gap) > 2.5;
        if (state.snapped || calm()) state.s = state.sTarget;
        else {
            const k = 1 - Math.exp(-dt / 110);
            state.s += gap * k;
            if (Math.abs(state.sTarget - state.s) < 0.0004) state.s = state.sTarget;
        }
        state.crossedUp = prev < REVEAL_AT && state.s >= REVEAL_AT;

        const lampMoving = stepLamp(dt);
        frame(now);
        chrome();

        const time = (now - state.t0) / 1000;
        const busy = state.s !== state.sTarget
            || lampMoving
            || (state.s < 1.8 && !calm())                       // the prologue's light is alive
            || time < 8                                          // the poetry's clock
            || now - state.revealAt < 1800
            || now - state.pulseAt < 1500
            || state.programmatic;
        if (busy) state.raf = requestAnimationFrame(tick);
        else { state.running = false; state.last = 0; }
    }

    function kick() {
        if (state.paused || state.raf) return;
        state.running = true;
        state.raf = requestAnimationFrame(tick);
    }

    // ── Controls, progress, address, announcements ──────────────────────────
    function currentStop(s) {
        let idx = 0;
        STOPS.forEach((st, i) => { if (s >= st.s - 0.35) idx = i; });
        return idx;
    }

    function chrome() {
        const sT = state.sTarget;
        const s = state.s;
        const end = sT >= SCREENS - 0.1;
        if (end !== state.endMode) {
            // Read before hiding: hiding a focused button blurs it.
            const had = document.activeElement;
            const lostControl = had === nextBtn || had === skipBtn || had === replayBtn;
            state.endMode = end;
            root.classList.toggle('nt-end', end);
            nextBtn.hidden = end;
            skipBtn.hidden = end;
            replayBtn.hidden = !end;
            if (end) {
                try { localStorage.setItem('void-neant-seen', '1'); } catch (e) { /* ignore */ }
                if (lostControl) focusQuietly(replayBtn);
            } else if (lostControl) {
                focusQuietly(nextBtn);
            }
        }
        backBtn.disabled = sT <= 0.02;

        let chapter = 1;
        if (s >= CHAPTERS[3][0]) chapter = 3; else if (s >= CHAPTERS[2][0]) chapter = 2;
        progressBtns.forEach((btn) => {
            const c = Number(btn.dataset.chapter);
            const [a, b] = CHAPTERS[c];
            const fill = c < chapter ? 1 : c > chapter ? 0 : clamp((s - a) / (b - a), 0, 1);
            put(btn.querySelector('.nt-progress-bar i'), '--fill', (Math.round(fill * 200) / 200).toString());
            if (c === chapter) btn.setAttribute('aria-current', 'step'); else btn.removeAttribute('aria-current');
        });
        if (chapter !== state.chapter) {
            if (state.chapter) live.textContent = t('live').replace('{n}', String(chapter)).replace('{title}', t(`ch${chapter}`));
            state.chapter = chapter;
        }

        const stop = currentStop(s);
        if (stop !== state.stop) {
            state.stop = stop;
            if (root.classList.contains('nt-ready')) {
                const hash = stop === 0 ? '' : `#${STOPS[stop].id}`;
                if (location.hash !== hash) {
                    try { history.replaceState(history.state, '', `${location.pathname}${location.search}${hash}`); } catch (e) { /* ignore */ }
                }
            }
        }
    }

    // Moving the scroll position: the story follows it.
    function scrollToS(s, instant) {
        cancelProgrammatic();
        const y = Math.round(geo.top + s * geo.vh);
        if (instant || calm()) {
            window.scrollTo(0, y);
            readScroll();
            kick();
            return;
        }
        const from = window.scrollY;
        const dist = y - from;
        const duration = clamp(650 + Math.abs(dist / geo.vh) * 300, 750, 2200);
        const start = performance.now();
        const anim = { cancelled: false, toS: s };
        state.programmatic = anim;
        const step = (now) => {
            if (anim.cancelled) return;
            const x = clamp((now - start) / duration, 0, 1);
            const e = x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
            window.scrollTo(0, from + dist * e);
            if (x < 1) requestAnimationFrame(step);
            else if (state.programmatic === anim) state.programmatic = null;
        };
        requestAnimationFrame(step);
        kick();
    }

    function cancelProgrammatic() {
        if (state.programmatic) state.programmatic.cancelled = true;
        state.programmatic = null;
    }

    // A visitor's own scrolling always wins over a control's.
    ['wheel', 'touchstart'].forEach((type) => window.addEventListener(type, cancelProgrammatic, { passive: true }));

    // Where the story is headed: a control pressed twice moves on from where
    // the first press is going, not from where the scroll happens to be.
    const destination = () => (state.programmatic ? state.programmatic.toS : state.sTarget);
    function next() {
        const s = destination();
        const st = STOPS.find((x) => x.s > s + 0.12);
        if (st) scrollToS(st.s);
    }
    function back() {
        const s = destination();
        const prior = STOPS.filter((x) => x.s < s - 0.12);
        if (prior.length) scrollToS(prior[prior.length - 1].s);
    }
    function skip() { scrollToS(SCREENS, true); }
    function replay() {
        scrollToS(0, true);
        state.t0 = performance.now();
        state.linesShown = [false, false, false];
        lines.forEach((l) => hide(l));
        state.scrolled = false;
        state.revealed = false;
        hide(announceName);
        state.lamp.ti = 0; state.lamp.i = 0; state.lamp.tapIndex = -1;
        focusQuietly(nextBtn);
        kick();
    }

    function focusQuietly(el) { try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); } }

    backBtn.addEventListener('click', back);
    nextBtn.addEventListener('click', next);
    skipBtn.addEventListener('click', skip);
    replayBtn.addEventListener('click', replay);
    progressBtns.forEach((btn) => btn.addEventListener('click', () => {
        const c = Number(btn.dataset.chapter);
        scrollToS(STOPS[CHAPTER_STOP[c]].s);
    }));

    // Arrow keys step through the story; vertical keys stay native scrolling.
    document.addEventListener('keydown', (e) => {
        if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
        const el = e.target;
        if (el && el.closest && el.closest('input, textarea, select, [contenteditable="true"]')) return;
        if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); back(); }
        else if (e.key === 'Escape' && state.sTarget < SCREENS - 0.1) { e.preventDefault(); skip(); }
        else cancelProgrammatic();
    });

    window.addEventListener('scroll', () => { readScroll(); kick(); }, { passive: true });

    let resizeTimer = 0;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => { measure(); readScroll(); kick(); }, 80);
    });

    // ── Leaving or hiding the page stops every effect ─────────────────────────
    function pause() {
        state.paused = true;
        root.classList.add('nt-paused');
        cancelProgrammatic();
        if (state.raf) cancelAnimationFrame(state.raf);
        state.raf = 0;
        state.running = false;
        const css = typeof CSSAnimation === 'function' ? CSSAnimation : null;
        document.getAnimations().forEach((a) => {
            if (a.playState === 'running' && !(css && a instanceof css)) { try { a.finish(); } catch (e) { /* ignore */ } }
        });
    }
    function resume() {
        state.paused = false;
        root.classList.remove('nt-paused');
        state.last = 0;
        measure();
        readScroll();
        kick();
    }
    document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); else resume(); });
    window.addEventListener('pagehide', pause);
    window.addEventListener('pageshow', (e) => { if (e.persisted) resume(); });

    // If the artwork cannot load, the bottle stays out of the scene rather
    // than showing a broken image.
    bottle.querySelector('.nt-b-glass img').addEventListener('error', () => root.classList.add('nt-noart'));

    // ── The list ─────────────────────────────────────────────────────────────
    (function unveilingList() {
        const form = $('ntForm');
        const input = $('ntEmail');
        const submit = $('ntSubmit');
        const status = $('ntFormStatus');
        if (!form || !input || !submit || !status) return;
        const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        let sending = false;

        function setState(st, message) {
            if (st) form.dataset.state = st; else delete form.dataset.state;
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
                    status.setAttribute('tabindex', '-1');
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
    root.classList.toggle('nt-calm', calm());
    const onCalmChange = () => { root.classList.toggle('nt-calm', calm()); kick(); };
    if (reducedQuery.addEventListener) reducedQuery.addEventListener('change', onCalmChange);
    measure();

    // Where to begin. Back/forward and reload keep the browser's own position.
    // A link to a passage opens on it. A visitor who has already seen the
    // story opens on the final scene, with Replay to see it again.
    const nav = (performance.getEntriesByType && performance.getEntriesByType('navigation')[0]) || {};
    const fromHash = STOPS.findIndex((st) => `#${st.id}` === location.hash);
    if (nav.type !== 'back_forward' && nav.type !== 'reload') {
        let seen = false;
        try { seen = localStorage.getItem('void-neant-seen') === '1'; } catch (e) { /* ignore */ }
        if (fromHash >= 0) window.scrollTo(0, Math.round(geo.top + STOPS[fromHash].s * geo.vh));
        else if (seen) window.scrollTo(0, Math.round(geo.top + SCREENS * geo.vh));
        else window.scrollTo(0, 0);
    }
    readScroll();
    state.s = state.sTarget;
    state.snapped = true;
    if (state.s > 1.4) {
        state.linesShown = [true, true, true];
        lines.forEach((l) => reveal(l, { instant: true }));
    }
    if (state.s >= 8.3) {
        state.finalShown = true;
        reveal(unveilCopy);
    }
    const now = performance.now();
    frame(now);
    state.snapped = false;
    chrome();
    root.classList.add('nt-ready');
    kick();

    // Read-only, for tests and debugging.
    window.__neant = {
        get s() { return state.s; },
        get target() { return state.sTarget; },
        get stop() { return STOPS[currentStop(state.s)].id; },
        get busy() { return state.running || Boolean(state.programmatic); },
        get settled() { return !state.programmatic && Math.abs(state.s - state.sTarget) < 0.0005; },
        get running() { return state.running; },
        get revealed() { return state.revealed; },
        get flashes() { return state.flashes; },
        get lamp() { return { x: state.lamp.x, y: state.lamp.y, i: state.lamp.i, key: state.lamp.key }; },
        stops: STOPS.map((st) => ({ id: st.id, s: st.s })),
        screens: SCREENS,
        get vh() { return geo.vh; },
        get top() { return geo.top; }
    };
})();
