/*
 * ETERNAL VOID — After Effects template customiser
 * ------------------------------------------------
 * Opens the supplied .aet template as a new project, swaps the logo placeholder
 * for the original EV emblem, replaces website / brand placeholder text, checks
 * dependencies (footage, fonts, plugins), saves ETERNAL-VOID.aep and queues the
 * render. The original .aet and source assets are never modified.
 *
 * Run either:
 *   - via Run-EternalVoid.ps1 (recommended; sets the EV_* variables below), or
 *   - in After Effects: File > Scripts > Run Script File... (uses the defaults).
 *
 * Requires: Edit > Preferences > Scripting & Expressions >
 *           "Allow Scripts to Write Files and Access Network" = ON
 *
 * Configuration (environment variables, all optional):
 *   EV_ASSET_DIR      folder containing the template + assets
 *   EV_OUT_DIR        output folder (default <EV_ASSET_DIR>/ETERNAL VOID Output)
 *   EV_TEMPLATE       explicit path to the .aet (if more than one exists)
 *   EV_LOGO           explicit path to the original EV emblem (transparent PNG/PSD/AI/SVG)
 *   EV_LOGO_TARGET    exact project item name of the logo placeholder (footage item or comp)
 *   EV_LOGO_COLOR     original | white   (white = Fill effect, alpha preserved)
 *   EV_RENDER_COMP    exact name of the composition to render
 *   EV_RENDER_MODE    intermediate | h264 | none
 *   EV_HIDE_UNKNOWN   1 = disable text layers holding other placeholders (slogans etc.)
 *                     0 = stop and report them (default)
 *   EV_FORCE          1 = continue even if dependencies are missing (NOT recommended)
 *   EV_DRY_RUN        1 = inspect and report only, change nothing
 *   EV_QUIT           1 = quit After Effects when finished (used by the runner)
 */
(function () {
    // ------------------------------------------------------------------ config
    function env(k, d) {
        var v = $.getenv(k);
        return (v === null || v === undefined || v === "") ? d : v;
    }
    var ASSET_DIR = env("EV_ASSET_DIR", "C:/Eternalvoidco/Eternalvoidco/assets/After Effects Assets");
    var OUT_DIR = env("EV_OUT_DIR", ASSET_DIR + "/ETERNAL VOID Output");
    var TEMPLATE = env("EV_TEMPLATE", "");
    var LOGO = env("EV_LOGO", "");
    var LOGO_TARGET = env("EV_LOGO_TARGET", "");
    var LOGO_COLOR = env("EV_LOGO_COLOR", "original").toLowerCase();
    var RENDER_COMP = env("EV_RENDER_COMP", "");
    var RENDER_MODE = env("EV_RENDER_MODE", "intermediate").toLowerCase();
    var HIDE_UNKNOWN = env("EV_HIDE_UNKNOWN", "0") === "1";
    var FORCE = env("EV_FORCE", "0") === "1";
    var DRY_RUN = env("EV_DRY_RUN", "0") === "1";
    var QUIT = env("EV_QUIT", "0") === "1";

    var WEBSITE = "eternalvoid.co";
    var BRAND = "ETERNAL VOID";
    var PROJECT_NAME = "ETERNAL-VOID.aep";

    // Placeholder patterns
    var RX_WEBSITE = /your\s*web\s*site|web\s*site|www\.|https?:\/\/|your\s*(site|url|domain)|\.(com|net|org|co|io|info|biz)\b/i;
    var RX_BRAND = /your\s*(company|brand|business|logo|name|title)|(company|brand|business)\s*name|logo\s*text|^\s*(company|brand|logo|logotype)\s*$/i;
    var RX_OTHER = /lorem|ipsum|placeholder|your\s+\w+|text\s*here|title\s*here|insert\s|slogan|tagline|sub\s*title\s*here|edit\s*me/i;
    var RX_LOGO_ITEM = /(^|[^a-z])logo([^a-z]|$)|your\s*logo|place\s*logo|logo\s*here|placeholder/i;
    var RX_LOGO_FILE = /emblem|eternal\s*void|eternalvoid|(^|[^a-z])ev([^a-z]|$)/i;
    var RX_BAD_LOGO_FILE = /speck|noise|generated|variant|damaged|preview|mock/i;
    var IMG_EXT = /\.(png|psd|ai|eps|svg|tif|tiff|pdf)$/i;

    // ------------------------------------------------------------------ logging
    var LOG = [], BLOCKERS = [], WARNINGS = [], MANIFEST = [];
    function log(s) { LOG.push(s); try { $.writeln(s); } catch (e) {} }
    function warn(s) { WARNINGS.push(s); log("WARNING: " + s); }
    function block(s) { BLOCKERS.push(s); log("BLOCKER: " + s); }
    function man(k, v) { MANIFEST.push(k + "=" + v); }

    function trim(s) { return String(s).replace(/^\s+|\s+$/g, ""); }
    function oneLine(s) { return trim(String(s).replace(/[\r\n\u0003]+/g, " ")); }
    function inArr(a, v) { for (var i = 0; i < a.length; i++) if (a[i] === v) return true; return false; }
    function pad2(n) { return (n < 10 ? "0" : "") + n; }
    function stamp() {
        var d = new Date();
        return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + "-" + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
    }

    function writeText(path, text) {
        var f = new File(path);
        f.encoding = "UTF-8";
        if (!f.open("w")) return false;
        f.write(text);
        f.close();
        return true;
    }

    function finish() {
        var status = BLOCKERS.length ? "BLOCKED" : "OK";
        var out = [];
        out.push("ETERNAL VOID customiser — " + new Date().toString());
        out.push("After Effects " + app.version + " (build " + app.buildName + ")");
        out.push("STATUS=" + status);
        out.push("");
        out.push("== BLOCKERS (" + BLOCKERS.length + ")");
        out = out.concat(BLOCKERS);
        out.push("");
        out.push("== WARNINGS (" + WARNINGS.length + ")");
        out = out.concat(WARNINGS);
        out.push("");
        out.push("== LOG");
        out = out.concat(LOG);
        var ok = writeText(OUT_DIR + "/ev-customise-log.txt", out.join("\r\n"));
        MANIFEST.push("status=" + status);
        writeText(OUT_DIR + "/ev-manifest.txt", MANIFEST.join("\r\n"));
        if (!ok && !QUIT) {
            alert("Could not write the log. Enable Preferences > Scripting & Expressions > " +
                  "'Allow Scripts to Write Files and Access Network'.\n\n" + out.slice(0, 40).join("\n"));
        } else if (!QUIT) {
            alert("ETERNAL VOID: " + status + "\n" + BLOCKERS.join("\n") + "\n\nLog: " + OUT_DIR + "/ev-customise-log.txt");
        }
        try { app.endSuppressDialogs(false); } catch (e) {}
        if (QUIT) {
            try { app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES); } catch (e) {}
            app.quit();
        }
    }

    // ------------------------------------------------------------------ files
    function walk(folder, out, skipPath) {
        var items = folder.getFiles();
        for (var i = 0; i < items.length; i++) {
            var it = items[i];
            if (it instanceof Folder) {
                if (skipPath && it.fsName.toLowerCase() === skipPath.toLowerCase()) continue;
                walk(it, out, skipPath);
            } else {
                out.push(it);
            }
        }
        return out;
    }

    // ------------------------------------------------------------------ project helpers
    function allItems() {
        var a = [];
        for (var i = 1; i <= app.project.numItems; i++) a.push(app.project.item(i));
        return a;
    }
    function allComps() {
        var a = [], it = allItems();
        for (var i = 0; i < it.length; i++) if (it[i] instanceof CompItem) a.push(it[i]);
        return a;
    }
    function layersUsing(item) {
        var res = [], comps = item.usedIn;
        for (var c = 0; c < comps.length; c++) {
            for (var l = 1; l <= comps[c].numLayers; l++) {
                var L = comps[c].layer(l);
                try { if (L.source && L.source.id === item.id) res.push(L); } catch (e) {}
            }
        }
        return res;
    }
    function sourceTextProp(layer) {
        try { return layer.property("ADBE Text Properties").property("ADBE Text Document"); } catch (e) { return null; }
    }
    function midTime(layer) {
        var comp = layer.containingComp;
        var a = Math.max(0, layer.inPoint), b = Math.min(comp.duration, layer.outPoint);
        return (b > a) ? a + (b - a) / 2 : comp.duration / 2;
    }
    function collectTextDocProps(group, out) {
        for (var i = 1; i <= group.numProperties; i++) {
            var p = group.property(i);
            if (p.propertyType === PropertyType.PROPERTY) {
                if (p.propertyValueType === PropertyValueType.TEXT_DOCUMENT) out.push(p);
            } else {
                collectTextDocProps(p, out);
            }
        }
        return out;
    }
    function where(layer) { return "[" + layer.containingComp.name + "] layer " + layer.index + " \"" + layer.name + "\""; }

    // ------------------------------------------------------------------ start
    try { app.beginSuppressDialogs(); } catch (e) {}
    var outFolder = new Folder(OUT_DIR);
    if (!outFolder.exists) outFolder.create();
    log("Asset folder: " + ASSET_DIR);
    log("Output folder: " + OUT_DIR);

    var assetFolder = new Folder(ASSET_DIR);
    if (!assetFolder.exists) { block("Asset folder not found: " + ASSET_DIR); finish(); return; }

    var files = walk(assetFolder, [], outFolder.fsName);
    log("Files in asset folder (" + files.length + "):");
    for (var fi = 0; fi < files.length; fi++) log("  " + files[fi].fsName);

    // ---- template
    var tplFile = null;
    if (TEMPLATE) {
        tplFile = new File(TEMPLATE);
        if (!tplFile.exists) { block("EV_TEMPLATE not found: " + TEMPLATE); finish(); return; }
    } else {
        var tpls = [];
        for (fi = 0; fi < files.length; fi++) if (/\.aet$/i.test(files[fi].name)) tpls.push(files[fi]);
        if (tpls.length === 0) { block("No .aet template found in " + ASSET_DIR); finish(); return; }
        if (tpls.length > 1) {
            var names = [];
            for (var t = 0; t < tpls.length; t++) names.push(tpls[t].fsName);
            block("Several .aet templates found; set EV_TEMPLATE / -Template to one of:\n    " + names.join("\n    "));
            finish(); return;
        }
        tplFile = tpls[0];
    }
    log("Template: " + tplFile.fsName);
    man("template", tplFile.fsName);

    // ---- logo
    var logoFile = null;
    if (LOGO) {
        logoFile = new File(LOGO);
        if (!logoFile.exists) { block("EV_LOGO not found: " + LOGO); finish(); return; }
    } else {
        var cands = [];
        for (fi = 0; fi < files.length; fi++) {
            var nm = files[fi].displayName;
            if (IMG_EXT.test(nm) && RX_LOGO_FILE.test(nm) && !RX_BAD_LOGO_FILE.test(nm)) cands.push(files[fi]);
        }
        if (cands.length !== 1) {
            var cn = [];
            for (var c2 = 0; c2 < cands.length; c2++) cn.push(cands[c2].fsName);
            block((cands.length ? "Several" : "No") + " EV emblem candidates found; set EV_LOGO / -Logo to the original clean transparent file." +
                  (cn.length ? "\n    " + cn.join("\n    ") : ""));
            finish(); return;
        }
        logoFile = cands[0];
    }
    log("Logo: " + logoFile.fsName);
    man("logo", logoFile.fsName);

    // ---- open template as new project
    var proj;
    try {
        proj = app.open(tplFile);
    } catch (e) {
        block("After Effects " + app.version + " could not open the template (likely saved by a newer AE version, or damaged): " + e.toString());
        finish(); return;
    }
    if (!proj) { block("Opening the template returned no project."); finish(); return; }
    log("Opened template as new project. AE version " + app.version);
    man("ae_version", app.version);

    // ------------------------------------------------------------------ inventory
    var comps = allComps();
    log("");
    log("Compositions (" + comps.length + "):");
    for (var ci = 0; ci < comps.length; ci++) {
        var C = comps[ci];
        log("  \"" + C.name + "\" " + C.width + "x" + C.height + " @" + C.frameRate + "fps, " + C.duration.toFixed(3) +
            "s, layers=" + C.numLayers + ", usedIn=" + C.usedIn.length);
    }

    // missing footage
    var items = allItems();
    for (var ii = 0; ii < items.length; ii++) {
        var it = items[ii];
        if (it instanceof FootageItem && it.footageMissing) {
            var mp = "";
            try { mp = it.mainSource.missingFootagePath; } catch (e) {}
            if (it.usedIn.length === 0) {
                warn("Unused missing footage: \"" + it.name + "\" " + mp);
            } else if (RX_LOGO_ITEM.test(it.name)) {
                log("Missing footage \"" + it.name + "\" looks like the logo placeholder (will be replaced). " + mp);
            } else {
                block("Missing footage: \"" + it.name + "\" " + mp + " (used in " + it.usedIn.length + " comp(s))");
            }
        }
    }

    // effects / plugins
    var installed = {};
    try { for (var ef = 0; ef < app.effects.length; ef++) installed[app.effects[ef].matchName] = app.effects[ef].displayName; }
    catch (e) { warn("Could not read installed effects list: " + e); }
    var usedFx = {}, fonts = {};
    for (ci = 0; ci < comps.length; ci++) {
        for (var li = 1; li <= comps[ci].numLayers; li++) {
            var L = comps[ci].layer(li);
            var par = null;
            try { par = L.property("ADBE Effect Parade"); } catch (e) {}
            if (par) for (var k = 1; k <= par.numProperties; k++) {
                var fxp = par.property(k);
                if (!usedFx[fxp.matchName]) usedFx[fxp.matchName] = [];
                usedFx[fxp.matchName].push(where(L) + " \"" + fxp.name + "\"");
            }
            var st = sourceTextProp(L);
            if (st) {
                try {
                    var d0 = st.value;
                    fonts[d0.font] = fonts[d0.font] || [];
                    fonts[d0.font].push(where(L));
                    try { if (d0.fontObject && d0.fontObject.isSubstitute) block("Font missing/substituted: " + d0.font + " at " + where(L)); } catch (e) {}
                } catch (e) {}
            }
        }
    }
    log("");
    log("Effects used:");
    for (var mn in usedFx) {
        if (!usedFx.hasOwnProperty(mn)) continue;
        var ok = installed.hasOwnProperty(mn);
        log("  " + mn + (ok ? " (" + installed[mn] + ")" : " NOT INSTALLED") + " x" + usedFx[mn].length);
        if (!ok) block("Missing plugin/effect \"" + mn + "\" used at: " + usedFx[mn].join("; "));
    }
    log("Fonts used:");
    for (var fn in fonts) if (fonts.hasOwnProperty(fn)) log("  " + fn + " x" + fonts[fn].length);
    try {
        var mf = app.fonts.missingOrSubstitutedFonts;
        for (var m = 0; m < mf.length; m++) {
            var pn = mf[m].postScriptName || mf[m].familyName;
            var msg = "Font missing/substituted: " + pn;
            if (!inArr(BLOCKERS, msg)) block(msg);
        }
    } catch (e) {
        warn("This AE version cannot report missing fonts via scripting; check File > Dependencies > Fonts manually. Fonts listed above.");
    }

    if (BLOCKERS.length && !FORCE) { log("Stopping before changes because of blockers (set EV_FORCE=1 to override)."); finish(); return; }
    if (DRY_RUN) { log("Dry run — no changes made."); finish(); return; }

    // ------------------------------------------------------------------ save copy first
    var aepFile = new File(OUT_DIR + "/" + PROJECT_NAME);
    if (aepFile.exists) {
        var bak = OUT_DIR + "/ETERNAL-VOID.backup-" + stamp() + ".aep";
        aepFile.copy(bak);
        log("Existing project backed up to " + bak);
    }
    app.project.save(aepFile);
    log("Saved working copy: " + aepFile.fsName);

    // ------------------------------------------------------------------ logo
    app.beginUndoGroup("ETERNAL VOID customise");
    var logoItem = null;
    function importLogo() {
        if (logoItem) return logoItem;
        var io = new ImportOptions(logoFile);
        if (/\.(psd|ai|eps|pdf)$/i.test(logoFile.name)) {
            try { io.importAs = ImportAsType.FOOTAGE; } catch (e) {}
        }
        logoItem = app.project.importFile(io);
        logoItem.name = "EV emblem (original)";
        prepLogoItem(logoItem);
        return logoItem;
    }
    function prepLogoItem(item) {
        try { item.pixelAspect = 1; } catch (e) {}
        try { item.mainSource.guessAlphaMode(); } catch (e) {}
        var ha = false;
        try { ha = item.mainSource.hasAlpha; } catch (e) {}
        if (!ha) block("The supplied emblem has no alpha channel: " + logoFile.fsName + " — supply the clean transparent original.");
        log("Emblem source: " + item.width + "x" + item.height + ", alpha=" + ha);
        man("logo_px", item.width + "x" + item.height);
    }
    function addWhiteFill(layer) {
        if (LOGO_COLOR !== "white") return;
        var fx = layer.property("ADBE Effect Parade").addProperty("ADBE Fill");
        fx.property("ADBE Fill-0002").setValue([1, 1, 1, 1]);
        fx.name = "EV white (alpha preserved)";
        try { fx.moveTo(1); } catch (e) {}
        log("  Recoloured white with Fill (alpha preserved): " + where(layer));
    }
    function mapProp(p, fnc) {
        if (p.numKeys > 0) { for (var k = 1; k <= p.numKeys; k++) p.setValueAtKey(k, fnc(p.keyValue(k))); }
        else p.setValue(fnc(p.value));
        if (p.expressionEnabled && p.expression) warn("Expression on " + p.name + " of " + where(p.propertyGroup(p.propertyDepth)) + " — verify logo size visually.");
    }

    var logoTargets = [];
    if (LOGO_TARGET) {
        for (ii = 0; ii < items.length; ii++) if (items[ii].name === LOGO_TARGET) logoTargets.push(items[ii]);
        if (!logoTargets.length) block("EV_LOGO_TARGET \"" + LOGO_TARGET + "\" not found in project.");
    } else {
        for (ii = 0; ii < items.length; ii++) {
            it = items[ii];
            if (it instanceof FootageItem && it.usedIn.length && RX_LOGO_ITEM.test(it.name) && it.width > 0 &&
                !(it.mainSource instanceof SolidSource) &&
                (it.mainSource instanceof PlaceholderSource || it.mainSource.isStill)) logoTargets.push(it);
        }
        if (!logoTargets.length) {
            for (ii = 0; ii < items.length; ii++) {
                it = items[ii];
                if (it instanceof CompItem && RX_LOGO_ITEM.test(it.name) && it.usedIn.length) logoTargets.push(it);
            }
        }
    }

    if (!logoTargets.length && !BLOCKERS.length) {
        var all = [];
        for (ii = 0; ii < items.length; ii++) all.push((items[ii] instanceof CompItem ? "comp " : (items[ii] instanceof FolderItem ? "folder " : "footage ")) + "\"" + items[ii].name + "\"");
        block("Could not identify the logo placeholder. Set EV_LOGO_TARGET / -LogoTarget to the exact item name. Project items:\n    " + all.join("\n    "));
    }

    var replacedLogoLayers = 0;
    for (var lt = 0; lt < logoTargets.length && !BLOCKERS.length; lt++) {
        var tgt = logoTargets[lt];
        if (tgt instanceof FootageItem) {
            // Swap the source: every layer, nested comp, effect and keyframe stays intact.
            var users = layersUsing(tgt);
            var ow = tgt.width, oh = tgt.height, opa = tgt.pixelAspect;
            log("Replacing footage placeholder \"" + tgt.name + "\" (" + ow + "x" + oh + ", used by " + users.length + " layer(s))");
            tgt.replace(logoFile);
            prepLogoItem(tgt);
            var nw = tgt.width, nh = tgt.height;
            var f = Math.min((ow * opa) / nw, oh / nh); // fit inside the placeholder box, uniform
            for (var u = 0; u < users.length; u++) {
                var UL = users[u];
                // Multiply every scale value by the same factor so the template's own
                // scale animation is preserved exactly; only the base size changes.
                var sv = UL.transform.scale.value;
                if (UL.transform.scale.numKeys === 0 && Math.abs(Math.abs(sv[0]) - Math.abs(sv[1])) > 0.01)
                    warn("Placeholder layer has non-uniform scale " + sv[0] + "/" + sv[1] + " at " + where(UL) + " — emblem would be stretched; set equal X/Y scale.");
                mapProp(UL.transform.scale, function (v) {
                    return v.length > 2 ? [v[0] * f, v[1] * f, v[2] * f] : [v[0] * f, v[1] * f];
                });
                mapProp(UL.transform.anchorPoint, function (v) {
                    var r = [v[0] * nw / ow, v[1] * nh / oh];
                    if (v.length > 2) r.push(v[2]);
                    return r;
                });
                addWhiteFill(UL);
                replacedLogoLayers++;
                log("  Fitted " + where(UL) + " factor " + f.toFixed(4));
            }
            tgt.name = "EV emblem (original)";
            logoItem = tgt;
        } else if (tgt instanceof CompItem) {
            // Logo comp: place the emblem over the placeholder area and disable placeholder layers.
            log("Logo comp \"" + tgt.name + "\" (" + tgt.width + "x" + tgt.height + ")");
            var box = null, topPh = null, ph = [];
            for (li = 1; li <= tgt.numLayers; li++) {
                L = tgt.layer(li);
                if (L instanceof CameraLayer || L instanceof LightLayer) continue;
                if (L.guideLayer || L.adjustmentLayer || L.nullLayer || L.isTrackMatte || !L.enabled) continue;
                ph.push(L);
                if (!topPh) topPh = L;
                try {
                    var tm = midTime(L), r = L.sourceRectAtTime(tm, false);
                    var a = L.transform.anchorPoint.valueAtTime(tm, false), s = L.transform.scale.valueAtTime(tm, false), p;
                    try { p = L.transform.position.valueAtTime(tm, false); }
                    catch (e) { p = [L.transform.xPosition.valueAtTime(tm, false), L.transform.yPosition.valueAtTime(tm, false)]; }
                    if (L.parent) warn("Placeholder " + where(L) + " is parented; logo box is approximate.");
                    var x1 = p[0] + (r.left - a[0]) * s[0] / 100, x2 = p[0] + (r.left + r.width - a[0]) * s[0] / 100;
                    var y1 = p[1] + (r.top - a[1]) * s[1] / 100, y2 = p[1] + (r.top + r.height - a[1]) * s[1] / 100;
                    var bx = [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
                    if (bx[2] - bx[0] > 1 && bx[3] - bx[1] > 1)
                        box = box ? [Math.min(box[0], bx[0]), Math.min(box[1], bx[1]), Math.max(box[2], bx[2]), Math.max(box[3], bx[3])] : bx;
                } catch (e) { warn("Could not measure " + where(L) + ": " + e); }
            }
            if (!box) box = [tgt.width * 0.05, tgt.height * 0.05, tgt.width * 0.95, tgt.height * 0.95];
            box = [Math.max(0, box[0]), Math.max(0, box[1]), Math.min(tgt.width, box[2]), Math.min(tgt.height, box[3])];
            var li2 = importLogo();
            var NL = tgt.layers.add(li2);
            NL.name = "EV emblem";
            if (topPh) NL.moveBefore(topPh);
            var bw = box[2] - box[0], bh = box[3] - box[1];
            var sc = Math.min(bw / li2.width, bh / li2.height) * 100;
            NL.transform.anchorPoint.setValue([li2.width / 2, li2.height / 2]);
            NL.transform.position.setValue([box[0] + bw / 2, box[1] + bh / 2]);
            NL.transform.scale.setValue([sc, sc]);
            NL.startTime = 0; NL.inPoint = 0; NL.outPoint = tgt.duration;
            addWhiteFill(NL);
            for (var q = 0; q < ph.length; q++) { ph[q].enabled = false; ph[q].audioEnabled = false; log("  Disabled placeholder " + where(ph[q])); }
            log("  Emblem placed at box [" + box.join(", ") + "], scale " + sc.toFixed(2) + "%");
            replacedLogoLayers++;
        }
    }
    man("logo_layers_replaced", replacedLogoLayers);

    // ------------------------------------------------------------------ text
    function classify(t) {
        var s = oneLine(t);
        if (s === WEBSITE || s === BRAND || s === "") return null;
        if (RX_WEBSITE.test(s)) return "website";
        if (RX_BRAND.test(s)) return "brand";
        if (RX_OTHER.test(s)) return "other";
        return null;
    }
    function setText(prop, txt, kind, label) {
        function upd(d) {
            d.text = txt;
            if (kind === "website") {
                var caps = false;
                try { caps = d.allCaps || d.smallCaps; } catch (e) {}
                if (caps) {
                    try { d.fontCapsOption = FontCapsOption.FONT_NORMAL_CAPS; log("  Turned off All/Small Caps so the URL stays lowercase: " + label); }
                    catch (e) { warn("All Caps is on for " + label + " — URL would render uppercase. Turn off All Caps in the Character panel."); }
                }
            }
            return d;
        }
        if (prop.numKeys > 0) { for (var k = 1; k <= prop.numKeys; k++) prop.setValueAtKey(k, upd(prop.keyValue(k))); }
        else prop.setValue(upd(prop.value));
    }
    function fitText(layer) {
        var st = sourceTextProp(layer);
        if (!st || st.numKeys > 0) return;
        var comp = layer.containingComp, tm = midTime(layer);
        for (var n = 0; n < 30; n++) {
            var d = st.value, r = layer.sourceRectAtTime(tm, false);
            var sx = Math.abs(layer.transform.scale.valueAtTime(tm, false)[0]) / 100;
            var lines = oneLine(d.text) === d.text ? 1 : 2;
            var wraps = d.boxText && r.height > d.fontSize * (d.leading && d.leading > 0 ? d.leading / d.fontSize : 1.2) * lines * 1.25;
            var over = r.width * sx > comp.width * 0.92;
            if (!wraps && !over) { if (n) log("  Reduced font size to " + d.fontSize.toFixed(1) + " to fit: " + where(layer)); return; }
            d.fontSize = d.fontSize * 0.95;
            st.setValue(d);
        }
        warn("Text may still be clipped/wrapped: " + where(layer));
    }

    var unknown = [], textCount = { website: 0, brand: 0 };
    comps = allComps();
    for (ci = 0; ci < comps.length; ci++) {
        for (li = 1; li <= comps[ci].numLayers; li++) {
            L = comps[ci].layer(li);
            // regular text layers
            var stp = sourceTextProp(L);
            if (stp) {
                var vals = [];
                if (stp.numKeys) { for (k = 1; k <= stp.numKeys; k++) vals.push(stp.keyValue(k).text); } else vals.push(stp.value.text);
                if (stp.expressionEnabled && stp.expression) {
                    try { vals.push(stp.valueAtTime(midTime(L), false).text); } catch (e) {}
                }
                var kind = null;
                for (var v = 0; v < vals.length && !kind; v++) kind = classify(vals[v]);
                if (kind === "website" || kind === "brand") {
                    if (!L.enabled) { log("Skipping disabled text " + where(L)); }
                    else {
                        var newT = kind === "website" ? WEBSITE : BRAND;
                        setText(stp, newT, kind, where(L));
                        textCount[kind]++;
                        log("Text " + kind + ": \"" + oneLine(vals[0]) + "\" -> \"" + newT + "\" at " + where(L));
                        if (stp.expressionEnabled && stp.expression) warn("Source Text has an expression at " + where(L) + "; verify the rendered text.");
                        fitText(L);
                    }
                } else if (kind === "other" && L.enabled) {
                    unknown.push({ layer: L, text: oneLine(vals[0]) });
                }
            }
            // Essential Graphics overrides on precomp layers
            var ov = null;
            try { ov = L.property("ADBE Layer Overrides"); } catch (e) {}
            if (ov && ov.numProperties) {
                var tps = collectTextDocProps(ov, []);
                for (var tp = 0; tp < tps.length; tp++) {
                    var ovv = tps[tp].value.text, ok2 = classify(ovv) || classify(tps[tp].name);
                    if (ok2 === "website" || ok2 === "brand") {
                        var nt = ok2 === "website" ? WEBSITE : BRAND;
                        setText(tps[tp], nt, ok2, where(L) + " override \"" + tps[tp].name + "\"");
                        textCount[ok2]++;
                        log("Override " + ok2 + ": \"" + oneLine(ovv) + "\" -> \"" + nt + "\" at " + where(L) + " / " + tps[tp].name);
                    } else if (ok2 === "other") {
                        warn("Essential Graphics override \"" + tps[tp].name + "\" = \"" + oneLine(ovv) + "\" at " + where(L) + " looks like a placeholder.");
                    }
                }
                for (var op = 1; op <= ov.numProperties; op++) {
                    if (/logo/i.test(ov.property(op).name)) warn("Essential Graphics media/logo override \"" + ov.property(op).name + "\" at " + where(L) + " — confirm it shows the EV emblem.");
                }
            }
        }
    }
    man("website_replacements", textCount.website);
    man("brand_replacements", textCount.brand);
    if (textCount.website === 0) warn("No website placeholder text was found. If the template shows a URL, set it to \"" + WEBSITE + "\" manually.");

    for (var un = 0; un < unknown.length; un++) {
        var U = unknown[un];
        if (HIDE_UNKNOWN) { U.layer.enabled = false; log("Disabled other placeholder text \"" + U.text + "\" at " + where(U.layer)); }
        else block("Unhandled placeholder text \"" + U.text + "\" at " + where(U.layer) +
                   " — not replaced (no slogan supplied). Re-run with -HideOtherPlaceholders to hide it, or edit it manually.");
    }
    app.endUndoGroup();

    // ------------------------------------------------------------------ render comp
    comps = allComps();
    var rc = null;
    if (RENDER_COMP) {
        for (ci = 0; ci < comps.length; ci++) if (comps[ci].name === RENDER_COMP) rc = comps[ci];
        if (!rc) block("EV_RENDER_COMP \"" + RENDER_COMP + "\" not found.");
    } else {
        var tops = [];
        for (ci = 0; ci < comps.length; ci++) if (comps[ci].usedIn.length === 0) tops.push(comps[ci]);
        if (tops.length === 1) rc = tops[0];
        else {
            var named = [];
            for (ci = 0; ci < tops.length; ci++) if (/render|final|main|output|export/i.test(tops[ci].name)) named.push(tops[ci]);
            if (named.length === 1) rc = named[0];
            else {
                var tn = [];
                for (ci = 0; ci < tops.length; ci++) tn.push("\"" + tops[ci].name + "\" " + tops[ci].duration.toFixed(2) + "s");
                block("Cannot decide which composition to render; set EV_RENDER_COMP / -RenderComp to one of:\n    " + tn.join("\n    "));
            }
        }
    }
    if (rc) {
        log("Render comp: \"" + rc.name + "\" " + rc.width + "x" + rc.height + " @" + rc.frameRate + "fps, " + rc.duration.toFixed(3) + "s");
        man("comp", rc.name);
        man("width", rc.width);
        man("height", rc.height);
        man("fps", rc.frameRate);
        man("duration", rc.duration);
        man("frames", Math.round(rc.duration * rc.frameRate));
        man("pixel_aspect", rc.pixelAspect);
        if (rc.pixelAspect !== 1) warn("Comp pixel aspect is " + rc.pixelAspect + " (non-square).");
        if (rc.workAreaStart !== 0 || Math.abs(rc.workAreaDuration - rc.duration) > 1e-6)
            warn("Work area (" + rc.workAreaStart + "s +" + rc.workAreaDuration + "s) differs from comp length; rendering full comp length.");
        var hasAudio = false;
        var scanAudio = function (comp, depth) {
            if (depth > 20) return;
            for (var i = 1; i <= comp.numLayers; i++) {
                var X = comp.layer(i);
                try {
                    if (X.hasAudio && X.audioEnabled) {
                        if (X.source instanceof CompItem) scanAudio(X.source, depth + 1);
                        else hasAudio = true;
                    }
                } catch (e) {}
            }
        };
        scanAudio(rc, 0);
        man("has_audio", hasAudio ? 1 : 0);
        log("Audio in render comp: " + (hasAudio ? "yes" : "no"));
    }

    // ------------------------------------------------------------------ final placeholder sweep
    comps = allComps();
    for (ci = 0; ci < comps.length; ci++) {
        for (li = 1; li <= comps[ci].numLayers; li++) {
            L = comps[ci].layer(li);
            if (!L.enabled) continue;
            stp = sourceTextProp(L);
            if (stp) {
                var tv = "";
                try { tv = stp.valueAtTime(midTime(L), false).text; } catch (e) { tv = stp.value.text; }
                var cl = classify(tv);
                if (cl === "website" || cl === "brand") block("Placeholder text still present \"" + oneLine(tv) + "\" at " + where(L));
            }
            try {
                if (L.source instanceof FootageItem && RX_LOGO_ITEM.test(L.source.name) && L.source !== logoItem)
                    warn("Layer still uses a logo-named item \"" + L.source.name + "\" at " + where(L) + " — confirm it is not a placeholder.");
                if (L.source instanceof FootageItem && L.source.footageMissing && L.source !== logoItem)
                    block("Layer uses missing footage \"" + L.source.name + "\" at " + where(L));
            } catch (e) {}
        }
    }

    // ------------------------------------------------------------------ save + queue
    if (BLOCKERS.length && !FORCE) {
        app.project.save(aepFile);
        log("Project saved but NOT queued for render because of blockers.");
        finish(); return;
    }

    var rq = app.project.renderQueue;
    for (var r = 1; r <= rq.numItems; r++) { try { rq.item(r).render = false; } catch (e) {} }
    if (RENDER_MODE !== "none" && rc) {
        var rqi = rq.items.add(rc);
        try { rqi.applyTemplate("Best Settings"); } catch (e) { warn("Render settings template 'Best Settings' unavailable: " + e); }
        rqi.timeSpanStart = 0;
        rqi.timeSpanDuration = rc.duration;
        var om = rqi.outputModule(1), tl = om.templates, chosen = null, ext = ".mov";
        if (RENDER_MODE === "h264") {
            var best = -1;
            for (var ti = 0; ti < tl.length; ti++) {
                var mm = /^H\.264.*?(\d+)\s*Mbps/i.exec(tl[ti]);
                if (/^H\.264/i.test(tl[ti])) { var mb = mm ? parseInt(mm[1], 10) : 0; if (mb > best) { best = mb; chosen = tl[ti]; } }
            }
            ext = ".mp4";
            if (!chosen) block("This After Effects version has no H.264 output module and no ffmpeg was provided. Install ffmpeg and re-run.");
        } else {
            var prefs = ["Lossless", "High Quality", "Lossless with Alpha", "High Quality with Alpha"];
            for (var pi = 0; pi < prefs.length && !chosen; pi++) if (inArr(tl, prefs[pi])) chosen = prefs[pi];
            if (!chosen) block("No lossless/high-quality output module template found. Available: " + tl.join(", "));
        }
        if (chosen) {
            om.applyTemplate(chosen);
            try { if (hasAudio) om.setSettings({ "Output Audio": "On" }); } catch (e) { warn("Could not force audio output on (" + e + "); check the intermediate has audio."); }
            var outPath = OUT_DIR + "/" + (RENDER_MODE === "h264" ? "ETERNAL-VOID-Final" : "ETERNAL-VOID-intermediate") + ext;
            om.file = new File(outPath);
            log("Queued \"" + rc.name + "\" with output module \"" + chosen + "\" -> " + om.file.fsName);
            man("render_output", om.file.fsName);
            man("render_mode", RENDER_MODE);
        }
    }
    app.project.save(aepFile);
    log("Saved: " + aepFile.fsName);
    man("project", aepFile.fsName);
    finish();
})();
