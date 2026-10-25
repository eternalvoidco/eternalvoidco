// ─────────────────────────────────────────────────────────────────────────────
// /fragrance — NÉANT, Extrait de Parfum.
//
// The page is an ordinary document: the browser owns scrolling. Nothing here
// listens to wheel, touch or scroll events, and nothing moves with the scroll
// position. What the script does is small and event-driven:
//
//   · the storefront's language (localStorage voidLanguage), in four languages
//   · the header's backing and the phone dock, from IntersectionObservers
//   · the bag count, read from the same localStorage key the checkout reads
//   · "Receive the unveiling": the signup for NÉANT on /api/newsletter
//
// NÉANT has no price, size or stock anywhere in the house (api/_catalog.js does
// not list it, and the checkout refuses it), so it is offered as a list to
// join, never as something to put in the bag. When it gets a catalogue entry,
// the hero's form is the place an "Add to Bag" control belongs.
// ─────────────────────────────────────────────────────────────────────────────
(function () {
    'use strict';

    const root = document.documentElement;
    const $ = (id) => document.getElementById(id);

    // ── Words ────────────────────────────────────────────────────────────────
    // German addresses the reader as "du", as the rest of the site does.
    const I18N = {
        en: {
            tagline: 'The void has a scent.',
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
            ch2: 'The Olfactory World',
            mono1: 'Some presences are felt before they are seen.',
            mono2: 'They move through silence.',
            mono3: 'And remain after they have gone.',
            opening: 'Opening',
            heart: 'Heart',
            base: 'Base',
            openingTitle: 'First Light',
            openingCopy: 'A cold spark breaks the dark. Bergamot and blackcurrant sharpen the air; pink pepper flickers, and saffron draws a thread of gilded heat.',
            heartTitle: 'The Inner Chamber',
            heartCopy: 'Behind closed doors, rose and jasmine open in the half-light. Incense rises from smoked woods: slow, devotional, close.',
            baseTitle: 'What Remains',
            baseCopy: 'Oud and leather settle into the dark, softened by amber and vanilla. Patchouli and musk hold what is left: a presence, not a trace.',
            notesLabel: 'Notes',
            bergamot: 'Bergamot',
            blackcurrant: 'Blackcurrant',
            saffron: 'Saffron',
            pinkPepper: 'Pink pepper',
            rose: 'Rose',
            jasmine: 'Jasmine',
            incense: 'Incense',
            smokyWoods: 'Smoky woods',
            oud: 'Oud',
            amber: 'Amber',
            vanilla: 'Vanilla',
            leather: 'Leather',
            patchouli: 'Patchouli',
            musk: 'Musk',
            direction: 'Creative direction — the composition is still being refined.',
            bottleAlt: 'The NÉANT bottle: black faceted glass with a gold serpent coiled at the neck, amber extrait within.',
            skipLink: 'Skip to content',
            navLabel: 'Site',
            footerLabel: 'Footer',
            navShop: 'Shop',
            navScent: 'The Scent',
            navDetails: 'Details',
            bag: 'Bag',
            bagLabel: 'Bag, {n} items',
            bagLabelOne: 'Bag, 1 item',
            bagEmpty: 'Bag, empty',
            factConcentration: 'Concentration',
            factNotes: 'Key notes',
            factSizePrice: 'Size & price',
            factAvailability: 'Availability',
            tba: 'To be announced',
            discover: 'Discover the Fragrance',
            shopCollection: 'Shop the Collection',
            scentTitle: 'The Scent',
            detailsTitle: 'Details',
            dHouse: 'House',
            dConcentration: 'Concentration',
            dTop: 'Top notes',
            dHeart: 'Heart notes',
            dBase: 'Base notes',
            dSize: 'Size',
            dPrice: 'Price',
            dAvailability: 'Availability',
            reserveTitle: 'Be first to receive it',
            reserveCopy: 'Size, price and release date have not yet been announced. Join the list and the unveiling will reach you first.',
            collectionKicker: 'Season One',
            collectionTitle: 'From the Collection',
            viewInShop: 'View in the shop',
            svcDelivery: 'Tracked delivery',
            svcDeliveryCopy: 'Safe, tracked home delivery worldwide.',
            svcReturns: 'Returns & exchanges',
            svcReturnsCopy: 'Free within 14 days, excluding personalised items.',
            svcSecure: 'Secure checkout',
            svcSecureCopy: 'All transactions are encrypted end to end.',
            frontBack: '{name} — front and back'
        },
        fr: {
            tagline: 'Le néant a un parfum.',
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
            ch2: 'L’Univers olfactif',
            mono1: 'Certaines présences se ressentent avant de se voir.',
            mono2: 'Elles traversent le silence.',
            mono3: 'Et demeurent, une fois parties.',
            opening: 'Ouverture',
            heart: 'Cœur',
            base: 'Fond',
            openingTitle: 'Première lumière',
            openingCopy: 'Une étincelle froide fend l’obscurité. La bergamote et le cassis aiguisent l’air ; le poivre rose scintille, et le safran trace un fil de chaleur dorée.',
            heartTitle: 'La Chambre intérieure',
            heartCopy: 'Derrière des portes closes, la rose et le jasmin s’ouvrent dans la pénombre. L’encens s’élève des bois fumés, lent, recueilli, intime.',
            baseTitle: 'Ce qui demeure',
            baseCopy: 'L’oud et le cuir se posent dans l’ombre, adoucis par l’ambre et la vanille. Le patchouli et le musc retiennent ce qui reste : une présence, non une trace.',
            notesLabel: 'Notes',
            bergamot: 'Bergamote',
            blackcurrant: 'Cassis',
            saffron: 'Safran',
            pinkPepper: 'Poivre rose',
            rose: 'Rose',
            jasmine: 'Jasmin',
            incense: 'Encens',
            smokyWoods: 'Bois fumés',
            oud: 'Oud',
            amber: 'Ambre',
            vanilla: 'Vanille',
            leather: 'Cuir',
            patchouli: 'Patchouli',
            musk: 'Musc',
            direction: 'Direction créative — la composition est encore en cours d’affinage.',
            bottleAlt: 'Le flacon NÉANT : verre noir facetté, serpent d’or enroulé au col, extrait ambré.',
            skipLink: 'Aller au contenu',
            navLabel: 'Site',
            footerLabel: 'Pied de page',
            navShop: 'Boutique',
            navScent: 'Le Parfum',
            navDetails: 'Détails',
            bag: 'Panier',
            bagLabel: 'Panier, {n} articles',
            bagLabelOne: 'Panier, 1 article',
            bagEmpty: 'Panier, vide',
            factConcentration: 'Concentration',
            factNotes: 'Notes clés',
            factSizePrice: 'Contenance & prix',
            factAvailability: 'Disponibilité',
            tba: 'À annoncer',
            discover: 'Découvrir le parfum',
            shopCollection: 'Découvrir la collection',
            scentTitle: 'Le Parfum',
            detailsTitle: 'Détails',
            dHouse: 'Maison',
            dConcentration: 'Concentration',
            dTop: 'Notes de tête',
            dHeart: 'Notes de cœur',
            dBase: 'Notes de fond',
            dSize: 'Contenance',
            dPrice: 'Prix',
            dAvailability: 'Disponibilité',
            reserveTitle: 'Soyez le premier à le recevoir',
            reserveCopy: 'La contenance, le prix et la date de sortie n’ont pas encore été annoncés. Inscrivez-vous et le dévoilement vous parviendra en premier.',
            collectionKicker: 'Saison Un',
            collectionTitle: 'De la collection',
            viewInShop: 'Voir en boutique',
            svcDelivery: 'Livraison suivie',
            svcDeliveryCopy: 'Livraison à domicile suivie et sécurisée, dans le monde entier.',
            svcReturns: 'Retours & échanges',
            svcReturnsCopy: 'Gratuits sous 14 jours, hors articles personnalisés.',
            svcSecure: 'Paiement sécurisé',
            svcSecureCopy: 'Toutes les transactions sont chiffrées de bout en bout.',
            frontBack: '{name} — recto et verso'
        },
        it: {
            tagline: 'Il vuoto ha un profumo.',
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
            ch2: 'Il Mondo olfattivo',
            mono1: 'Certe presenze si avvertono prima di vedersi.',
            mono2: 'Attraversano il silenzio.',
            mono3: 'E restano, anche dopo essersene andate.',
            opening: 'Apertura',
            heart: 'Cuore',
            base: 'Fondo',
            openingTitle: 'Prima luce',
            openingCopy: 'Una scintilla fredda squarcia il buio. Bergamotto e ribes nero affilano l’aria; il pepe rosa vibra, e lo zafferano traccia un filo di calore dorato.',
            heartTitle: 'La Stanza interiore',
            heartCopy: 'Dietro porte chiuse, rosa e gelsomino si schiudono nella penombra. L’incenso sale dai legni affumicati: lento, devoto, vicino.',
            baseTitle: 'Ciò che resta',
            baseCopy: 'Oud e cuoio si posano nel buio, addolciti da ambra e vaniglia. Patchouli e muschio custodiscono ciò che resta: una presenza, non una traccia.',
            notesLabel: 'Note',
            bergamot: 'Bergamotto',
            blackcurrant: 'Ribes nero',
            saffron: 'Zafferano',
            pinkPepper: 'Pepe rosa',
            rose: 'Rosa',
            jasmine: 'Gelsomino',
            incense: 'Incenso',
            smokyWoods: 'Legni affumicati',
            oud: 'Oud',
            amber: 'Ambra',
            vanilla: 'Vaniglia',
            leather: 'Cuoio',
            patchouli: 'Patchouli',
            musk: 'Muschio',
            direction: 'Direzione creativa — la composizione è ancora in fase di definizione.',
            bottleAlt: 'Il flacone NÉANT: vetro nero sfaccettato, un serpente d’oro avvolto al collo, estratto ambrato.',
            skipLink: 'Vai al contenuto',
            navLabel: 'Sito',
            footerLabel: 'Piè di pagina',
            navShop: 'Shop',
            navScent: 'La Fragranza',
            navDetails: 'Dettagli',
            bag: 'Carrello',
            bagLabel: 'Carrello, {n} articoli',
            bagLabelOne: 'Carrello, 1 articolo',
            bagEmpty: 'Carrello, vuoto',
            factConcentration: 'Concentrazione',
            factNotes: 'Note principali',
            factSizePrice: 'Formato e prezzo',
            factAvailability: 'Disponibilità',
            tba: 'Da annunciare',
            discover: 'Scopri la fragranza',
            shopCollection: 'Acquista la collezione',
            scentTitle: 'La Fragranza',
            detailsTitle: 'Dettagli',
            dHouse: 'Maison',
            dConcentration: 'Concentrazione',
            dTop: 'Note di testa',
            dHeart: 'Note di cuore',
            dBase: 'Note di fondo',
            dSize: 'Formato',
            dPrice: 'Prezzo',
            dAvailability: 'Disponibilità',
            reserveTitle: 'Ricevila per primo',
            reserveCopy: 'Formato, prezzo e data di uscita non sono ancora stati annunciati. Iscriviti alla lista e lo svelamento arriverà prima a te.',
            collectionKicker: 'Stagione Uno',
            collectionTitle: 'Dalla collezione',
            viewInShop: 'Vedi nello shop',
            svcDelivery: 'Spedizione tracciata',
            svcDeliveryCopy: 'Consegna a domicilio sicura e tracciata in tutto il mondo.',
            svcReturns: 'Resi e cambi',
            svcReturnsCopy: 'Gratuiti entro 14 giorni, esclusi gli articoli personalizzati.',
            svcSecure: 'Pagamento sicuro',
            svcSecureCopy: 'Tutte le transazioni sono crittografate end-to-end.',
            frontBack: '{name} — fronte e retro'
        },
        de: {
            tagline: 'Die Leere hat einen Duft.',
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
            ch2: 'Die Duftwelt',
            mono1: 'Manche Gegenwart spürt man, bevor man sie sieht.',
            mono2: 'Sie bewegt sich durch die Stille.',
            mono3: 'Und bleibt, wenn sie gegangen ist.',
            opening: 'Auftakt',
            heart: 'Herz',
            base: 'Basis',
            openingTitle: 'Erstes Licht',
            openingCopy: 'Ein kalter Funke bricht das Dunkel. Bergamotte und Schwarze Johannisbeere schärfen die Luft; rosa Pfeffer flackert, und Safran zieht einen Faden vergoldeter Wärme.',
            heartTitle: 'Die innere Kammer',
            heartCopy: 'Hinter verschlossenen Türen öffnen sich Rose und Jasmin im Halbdunkel. Weihrauch steigt aus rauchigen Hölzern: langsam, andächtig, nah.',
            baseTitle: 'Was bleibt',
            baseCopy: 'Oud und Leder senken sich ins Dunkel, gemildert von Amber und Vanille. Patchouli und Moschus halten, was bleibt: eine Gegenwart, keine Spur.',
            notesLabel: 'Noten',
            bergamot: 'Bergamotte',
            blackcurrant: 'Schwarze Johannisbeere',
            saffron: 'Safran',
            pinkPepper: 'Rosa Pfeffer',
            rose: 'Rose',
            jasmine: 'Jasmin',
            incense: 'Weihrauch',
            smokyWoods: 'Rauchige Hölzer',
            oud: 'Oud',
            amber: 'Amber',
            vanilla: 'Vanille',
            leather: 'Leder',
            patchouli: 'Patchouli',
            musk: 'Moschus',
            direction: 'Kreative Richtung — die Komposition wird noch verfeinert.',
            bottleAlt: 'Der NÉANT-Flakon: schwarzes, facettiertes Glas, eine goldene Schlange um den Hals gewunden, bernsteinfarbenes Extrait.',
            skipLink: 'Zum Inhalt springen',
            navLabel: 'Website',
            footerLabel: 'Fußzeile',
            navShop: 'Shop',
            navScent: 'Der Duft',
            navDetails: 'Details',
            bag: 'Warenkorb',
            bagLabel: 'Warenkorb, {n} Artikel',
            bagLabelOne: 'Warenkorb, 1 Artikel',
            bagEmpty: 'Warenkorb, leer',
            factConcentration: 'Konzentration',
            factNotes: 'Hauptnoten',
            factSizePrice: 'Größe & Preis',
            factAvailability: 'Verfügbarkeit',
            tba: 'Wird noch bekannt gegeben',
            discover: 'Den Duft entdecken',
            shopCollection: 'Zur Kollektion',
            scentTitle: 'Der Duft',
            detailsTitle: 'Details',
            dHouse: 'Haus',
            dConcentration: 'Konzentration',
            dTop: 'Kopfnoten',
            dHeart: 'Herznoten',
            dBase: 'Basisnoten',
            dSize: 'Größe',
            dPrice: 'Preis',
            dAvailability: 'Verfügbarkeit',
            reserveTitle: 'Erhalte ihn als Erstes',
            reserveCopy: 'Größe, Preis und Erscheinungsdatum sind noch nicht bekannt gegeben. Trag dich in die Liste ein, und die Enthüllung erreicht dich zuerst.',
            collectionKicker: 'Season One',
            collectionTitle: 'Aus der Kollektion',
            viewInShop: 'Im Shop ansehen',
            svcDelivery: 'Versand mit Sendungsverfolgung',
            svcDeliveryCopy: 'Sichere, nachverfolgbare Lieferung nach Hause, weltweit.',
            svcReturns: 'Rückgabe & Umtausch',
            svcReturnsCopy: 'Kostenlos innerhalb von 14 Tagen, ausgenommen personalisierte Artikel.',
            svcSecure: 'Sichere Bezahlung',
            svcSecureCopy: 'Alle Transaktionen sind durchgehend verschlüsselt.',
            frontBack: '{name} — Vorder- und Rückseite'
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
        document.querySelectorAll('[data-alt-name]').forEach((el) => {
            el.alt = t('frontBack').replace('{name}', el.dataset.altName);
        });
        document.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
            el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel));
        });
    }

    // ── Old addresses ────────────────────────────────────────────────────────
    // The page used to be a sequence of passages with their own anchors. The
    // three movements keep theirs (#opening, #heart, #base); the others all
    // meant "the product", which is now simply the top of the page.
    const LEGACY = ['prologue', 'announcement', 'unveiling'];
    function legacyHash() {
        if (!LEGACY.includes(location.hash.slice(1))) return;
        try { history.replaceState(history.state, '', location.pathname + location.search); } catch (e) { /* ignore */ }
        window.scrollTo({ top: 0, behavior: 'instant' });
    }
    legacyHash();
    window.addEventListener('hashchange', legacyHash);

    // ── Header backing ───────────────────────────────────────────────────────
    const nav = $('ntNav');
    const sentinel = $('ntTopSentinel');
    if (nav && sentinel && 'IntersectionObserver' in window) {
        new IntersectionObserver((entries) => {
            nav.classList.toggle('is-solid', !entries[entries.length - 1].isIntersecting);
        }).observe(sentinel);
    } else if (nav) {
        nav.classList.add('is-solid');
    }

    // ── The bag ──────────────────────────────────────────────────────────────
    // The same key and the same rules as the boutique and the checkout: a line
    // needs a name, a size, a price and a whole quantity, and the three preview
    // pieces are never counted.
    const UNRELEASED = ['Insigne Ivoire', 'Insigne Noir', 'Insigne Azure'];
    function bagCount() {
        try {
            const items = JSON.parse(localStorage.getItem('voidCart') || '[]');
            if (!Array.isArray(items)) return 0;
            return items.reduce((sum, item) => {
                const valid = item && typeof item.name === 'string' && typeof item.size === 'string'
                    && Number.isFinite(item.price) && Number.isInteger(item.quantity) && item.quantity > 0
                    && !UNRELEASED.includes(item.name);
                return valid ? sum + item.quantity : sum;
            }, 0);
        } catch (e) {
            return 0;
        }
    }

    function renderBag() {
        const link = $('ntBag');
        const badge = $('ntBagCount');
        if (!link || !badge) return;
        const n = bagCount();
        badge.textContent = String(n);
        badge.hidden = n === 0;
        link.setAttribute('aria-label', n === 0 ? t('bagEmpty') : n === 1 ? t('bagLabelOne') : t('bagLabel').replace('{n}', String(n)));
    }

    window.addEventListener('storage', (e) => { if (e.key === null || e.key === 'voidCart') renderBag(); });
    window.addEventListener('pageshow', renderBag);

    // ── The bottle ───────────────────────────────────────────────────────────
    (function bottle() {
        const stage = $('frStage');
        const img = $('ntBottleImg');
        if (!stage || !img) return;
        const missing = () => { stage.dataset.missing = ''; };
        img.addEventListener('error', missing);
        if (img.complete && img.naturalWidth === 0 && img.currentSrc) missing();
    })();

    // ── Getting to the form ──────────────────────────────────────────────────
    // One scroll (smooth only where the visitor has not asked for less
    // motion — html's scroll-behavior decides), then the field takes focus
    // without a second jump.
    function jumpToForm(e) {
        const form = $('ntForm');
        const input = $('ntEmail');
        if (!form || !input) return;
        if (e) e.preventDefault();
        const target = form.dataset.state === 'success' ? $('ntFormStatus') : input;
        form.scrollIntoView({ block: 'center' });
        if (target === input) {
            try { input.focus({ preventScroll: true }); } catch (err) { input.focus(); }
        }
    }
    document.querySelectorAll('[data-jump-form]').forEach((a) => a.addEventListener('click', jumpToForm));

    // ── The phone dock ───────────────────────────────────────────────────────
    // Shown only while neither the form nor the footer is on screen, so it is
    // never a second copy of what the visitor is already looking at and never
    // covers the end of the page. Phones only (CSS); this just keeps state.
    (function dock() {
        const el = $('ntDock');
        const form = $('ntForm');
        const footer = $('ntFooter');
        if (!el || !form || !footer || !('IntersectionObserver' in window)) return;
        const seen = new Map([[form, true], [footer, false]]);
        const update = () => {
            const show = !seen.get(form) && !seen.get(footer) && form.dataset.state !== 'success';
            el.classList.toggle('is-shown', show);
        };
        new IntersectionObserver((entries) => {
            entries.forEach((entry) => seen.set(entry.target, entry.isIntersecting));
            update();
        }).observe(form);
        new IntersectionObserver((entries) => {
            entries.forEach((entry) => seen.set(entry.target, entry.isIntersecting));
            update();
        }).observe(footer);
        form.addEventListener('nt-state', update);
    })();

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
            form.dispatchEvent(new Event('nt-state'));
        }

        input.addEventListener('input', () => {
            if (form.dataset.state === 'error') { setState(null, ''); input.removeAttribute('aria-invalid'); }
        });

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
                    if (!status.hasAttribute('tabindex')) status.setAttribute('tabindex', '-1');
                    try { status.focus({ preventScroll: true }); } catch (err) { status.focus(); }
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
    renderBag();
})();
