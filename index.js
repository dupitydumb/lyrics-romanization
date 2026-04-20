(function () {
	"use strict";

	const DEFAULT_SETTINGS = {
		enabled: true,
		showOriginal: true,
		autoScroll: true,
	};

	const LyricsRomanization = {
		name: "Lyrics Romanization",
		api: null,
		settings: { ...DEFAULT_SETTINGS },
		lyrics: [],
		romanizedLines: [],
		activeIndex: -1,
		lineCache: new Map(),
		remoteJaCache: {},
		cacheSaveTimer: null,
		isOpen: false,
		isFullscreen: false,
		currentTrackTitle: "",
		currentTrackArtist: "",
		currentTrackAlbum: "",
		currentArtwork: "",

		async init(api) {
			this.api = api;
			await this.loadSettings();
			await this.loadRemoteCache();

			this.injectStyles();
			this.createModal();
			this.createMenuButton();
			this.bindEvents();

			await this.refreshLyrics();
		},

		start() {},
		stop() {},

		destroy() {
			this.unbindEvents();
			this.cleanupUI();
			this.flushRemoteCache();
			this.lineCache.clear();
			this.lyrics = [];
			this.romanizedLines = [];
			this.activeIndex = -1;
			this.isFullscreen = false;
		},

		bindEvents() {
			this._onTrackChange = async (data) => {
				this.currentTrackTitle = data?.track?.title || "";
				await this.refreshLyrics();
			};
			this._onTimeUpdate = (data) => {
				this.updateActiveLine(data?.currentTime ?? 0);
			};
			this.api.on("trackChange", this._onTrackChange);
			this.api.on("timeUpdate", this._onTimeUpdate);
		},

		unbindEvents() {
			if (this._onTrackChange) this.api.off("trackChange", this._onTrackChange);
			if (this._onTimeUpdate) this.api.off("timeUpdate", this._onTimeUpdate);
			this._onTrackChange = null;
			this._onTimeUpdate = null;
		},

		async loadSettings() {
			try {
				const raw = await this.api.storage.get("settings");
				if (!raw) return;
				this.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
			} catch (e) {
				console.error("[LyricsRomanization] Failed to load settings:", e);
			}
		},

		async saveSettings() {
			try {
				await this.api.storage.set("settings", JSON.stringify(this.settings));
			} catch (e) {
				console.error("[LyricsRomanization] Failed to save settings:", e);
			}
		},

		async loadRemoteCache() {
			try {
				const raw = await this.api.storage.get("remote-ja-cache-v1");
				if (!raw) return;
				const parsed = JSON.parse(raw);
				if (parsed && typeof parsed === "object") this.remoteJaCache = parsed;
			} catch (e) {
				console.error("[LyricsRomanization] Failed to load remote cache:", e);
			}
		},

		scheduleRemoteCacheSave() {
			if (this.cacheSaveTimer) clearTimeout(this.cacheSaveTimer);
			this.cacheSaveTimer = setTimeout(async () => {
				this.cacheSaveTimer = null;
				await this.flushRemoteCache();
			}, 500);
		},

		async flushRemoteCache() {
			if (this.cacheSaveTimer) { clearTimeout(this.cacheSaveTimer); this.cacheSaveTimer = null; }
			try {
				await this.api.storage.set("remote-ja-cache-v1", JSON.stringify(this.remoteJaCache));
			} catch (e) {
				console.error("[LyricsRomanization] Failed to persist remote cache:", e);
			}
		},

		injectStyles() {
			if (document.getElementById("lr-styles")) return;
			const style = document.createElement("style");
			style.id = "lr-styles";
			style.textContent = `
				/* ── Overlay ── */
				#lr-overlay {
					position: fixed;
					inset: 0;
					background: rgba(0,0,0,.55);
					backdrop-filter: blur(8px);
					-webkit-backdrop-filter: blur(8px);
					z-index: 10000;
					opacity: 0;
					visibility: hidden;
					transition: opacity .25s ease;
				}
				#lr-overlay.open { opacity: 1; visibility: visible; }

				/* ── Modal (windowed) ── */
				#lr-modal {
					position: fixed;
					top: 50%; left: 50%;
					transform: translate(-50%, -50%) scale(.97);
					width: 680px;
					max-width: 92vw;
					max-height: 82vh;
					z-index: 10001;
					background: rgba(28,28,30,.92);
					backdrop-filter: blur(40px) saturate(1.6);
					-webkit-backdrop-filter: blur(40px) saturate(1.6);
					border: 1px solid rgba(255,255,255,.10);
					border-radius: 18px;
					box-shadow: 0 32px 80px rgba(0,0,0,.6), 0 0 0 .5px rgba(255,255,255,.06);
					display: flex;
					flex-direction: column;
					opacity: 0;
					visibility: hidden;
					transition: opacity .22s ease, transform .22s ease;
					overflow: hidden;
					font-family: -apple-system, "SF Pro Display", "Helvetica Neue", sans-serif;
				}
				#lr-modal.open {
					opacity: 1;
					visibility: visible;
					transform: translate(-50%, -50%) scale(1);
				}

				/* ── Fullscreen ── */
				#lr-modal.lr-fullscreen {
					inset: 0;
					top: 0; left: 0;
					width: 100vw; height: 100vh;
					max-width: 100vw; max-height: 100vh;
					transform: none !important;
					border-radius: 0;
					border: none;
					background: #000;
					box-shadow: none;
				}

				/* ── Ambient background ── */
				.lr-ambient {
					position: absolute;
					inset: 0;
					z-index: 0;
					pointer-events: none;
					overflow: hidden;
					opacity: 0;
					transition: opacity .5s ease;
				}
				#lr-modal.lr-fullscreen .lr-ambient { opacity: 1; }

				.lr-ambient-img {
					position: absolute;
					inset: -30%;
					width: 160%; height: 160%;
					background-size: cover;
					background-position: center;
					filter: blur(90px) saturate(2.2) brightness(.7);
					transform-origin: center;
				}
				.lr-ambient-img:nth-child(1) { animation: lrAmb1 20s infinite alternate ease-in-out; opacity: .85; }
				.lr-ambient-img:nth-child(2) { animation: lrAmb2 26s infinite alternate ease-in-out; opacity: .45; mix-blend-mode: soft-light; }
				.lr-ambient-overlay {
					position: absolute;
					inset: 0;
					background: linear-gradient(to bottom, rgba(0,0,0,.28) 0%, rgba(0,0,0,.72) 100%);
				}

				@keyframes lrAmb1 {
					0%   { transform: translate(-8%,-8%) scale(1) rotate(0deg); }
					100% { transform: translate(16%,20%) scale(1.25) rotate(12deg); }
				}
				@keyframes lrAmb2 {
					0%   { transform: translate(12%,-12%) scale(1.15) rotate(0deg); }
					100% { transform: translate(-20%,18%) scale(1) rotate(-14deg); }
				}

				/* ── Shell ── */
				.lr-shell {
					position: relative;
					z-index: 5;
					display: flex;
					flex-direction: column;
					height: 100%;
					min-height: 0;
				}

				/* ── Header ── */
				.lr-header {
					display: flex;
					align-items: center;
					gap: 12px;
					padding: 14px 16px 12px;
					border-bottom: 1px solid rgba(255,255,255,.08);
					background: rgba(0,0,0,.18);
					flex-shrink: 0;
				}
				.lr-artwork {
					width: 40px; height: 40px;
					border-radius: 8px;
					object-fit: cover;
					flex-shrink: 0;
					background: rgba(255,255,255,.08);
					display: none;
				}
				.lr-artwork.visible { display: block; }
				.lr-track-info { flex: 1; min-width: 0; }
				.lr-title {
					font-size: 13px;
					font-weight: 600;
					color: rgba(255,255,255,.95);
					margin: 0;
					white-space: nowrap;
					overflow: hidden;
					text-overflow: ellipsis;
				}
				.lr-subtitle {
					font-size: 11.5px;
					color: rgba(255,255,255,.50);
					margin-top: 2px;
					white-space: nowrap;
					overflow: hidden;
					text-overflow: ellipsis;
				}
				.lr-header-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
				.lr-icon-btn {
					width: 30px; height: 30px;
					border: none;
					background: rgba(255,255,255,.08);
					border-radius: 50%;
					color: rgba(255,255,255,.75);
					cursor: pointer;
					display: flex;
					align-items: center;
					justify-content: center;
					transition: background .15s ease, color .15s ease;
					flex-shrink: 0;
				}
				.lr-icon-btn:hover { background: rgba(255,255,255,.16); color: #fff; }
				.lr-icon-btn.active { background: rgba(255,255,255,.22); color: #fff; }
				.lr-icon-btn svg { width: 14px; height: 14px; }

				/* Fullscreen header adjustments */
				#lr-modal.lr-fullscreen .lr-header {
					padding: 18px 24px 14px;
					background: rgba(0,0,0,.3);
					border-color: rgba(255,255,255,.06);
				}
				#lr-modal.lr-fullscreen .lr-artwork { width: 48px; height: 48px; border-radius: 10px; }
				#lr-modal.lr-fullscreen .lr-title { font-size: 15px; }
				#lr-modal.lr-fullscreen .lr-subtitle { font-size: 13px; }
				#lr-modal.lr-fullscreen .lr-icon-btn { width: 34px; height: 34px; }
				#lr-modal.lr-fullscreen .lr-icon-btn svg { width: 16px; height: 16px; }

				/* ── Controls bar ── */
				.lr-controls {
					display: flex;
					flex-wrap: wrap;
					gap: 6px 14px;
					align-items: center;
					padding: 8px 16px;
					border-bottom: 1px solid rgba(255,255,255,.07);
					background: rgba(0,0,0,.12);
					flex-shrink: 0;
				}
				.lr-switch {
					display: inline-flex;
					align-items: center;
					gap: 7px;
					font-size: 12px;
					color: rgba(255,255,255,.70);
					user-select: none;
					cursor: pointer;
				}
				.lr-switch input[type=checkbox] {
					width: 28px; height: 16px;
					-webkit-appearance: none; appearance: none;
					background: rgba(255,255,255,.18);
					border-radius: 999px;
					position: relative;
					cursor: pointer;
					transition: background .18s ease;
					flex-shrink: 0;
				}
				.lr-switch input[type=checkbox]:checked { background: #ff375f; }
				.lr-switch input[type=checkbox]::after {
					content: "";
					position: absolute;
					top: 2px; left: 2px;
					width: 12px; height: 12px;
					background: #fff;
					border-radius: 50%;
					transition: transform .18s ease;
					box-shadow: 0 1px 3px rgba(0,0,0,.3);
				}
				.lr-switch input[type=checkbox]:checked::after { transform: translateX(12px); }
				.lr-pill-btn {
					border: 1px solid rgba(255,255,255,.14);
					background: rgba(255,255,255,.07);
					color: rgba(255,255,255,.70);
					border-radius: 999px;
					padding: 4px 12px;
					font-size: 11.5px;
					cursor: pointer;
					transition: all .15s ease;
					font-family: inherit;
				}
				.lr-pill-btn:hover {
					background: rgba(255,255,255,.14);
					color: #fff;
					border-color: rgba(255,255,255,.25);
				}
				#lr-modal.lr-fullscreen .lr-controls {
					background: rgba(0,0,0,.2);
					border-color: rgba(255,255,255,.06);
				}

				/* ── Body ── */
				.lr-body-wrap { flex: 1; min-height: 0; overflow: hidden; }
				.lr-body {
					padding: 16px 18px 20px;
					overflow-y: auto;
					height: 100%;
					display: flex;
					flex-direction: column;
					gap: 2px;
					scrollbar-width: thin;
					scrollbar-color: rgba(255,255,255,.12) transparent;
				}
				.lr-body::-webkit-scrollbar { width: 4px; }
				.lr-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,.15); border-radius: 2px; }

				/* Fullscreen body — Apple Music style */
				#lr-modal.lr-fullscreen .lr-body {
					padding: 20vh 0 28vh;
					max-width: 680px;
					margin: 0 auto;
					scrollbar-width: none;
					-ms-overflow-style: none;
					mask-image: linear-gradient(to bottom, transparent 0%, black 15%, black 82%, transparent 100%);
					-webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 15%, black 82%, transparent 100%);
				}
				#lr-modal.lr-fullscreen .lr-body::-webkit-scrollbar { display: none; }

				/* ── Lyric lines ── */
				.lr-line {
					padding: 5px 10px;
					border-radius: 10px;
					cursor: default;
					transition: opacity .2s ease;
				}
				.lr-line-original {
					font-size: 13px;
					font-weight: 500;
					color: rgba(255,255,255,.85);
					line-height: 1.5;
					white-space: pre-wrap;
					word-break: break-word;
					margin-bottom: 2px;
				}
				.lr-line-romanized {
					font-size: 13px;
					color: rgba(255,255,255,.45);
					letter-spacing: .01em;
					line-height: 1.5;
					white-space: pre-wrap;
					word-break: break-word;
					transition: color .2s ease;
				}
				.lr-line.active .lr-line-romanized { color: rgba(255,255,255,.95); }

				/* Fullscreen lyric lines — Apple Music big style */
				#lr-modal.lr-fullscreen .lr-line {
					padding: 6px 28px;
					border-radius: 0;
					opacity: .28;
					transition: opacity .32s ease, transform .32s ease;
					transform: scale(.98);
					transform-origin: left center;
				}
				#lr-modal.lr-fullscreen .lr-line.active {
					opacity: 1;
					transform: scale(1);
				}
				#lr-modal.lr-fullscreen .lr-line-original {
					font-size: clamp(.95rem, 1.5vw, 1.2rem);
					font-weight: 500;
					color: rgba(255,255,255,.65);
					line-height: 1.4;
					margin-bottom: 4px;
				}
				#lr-modal.lr-fullscreen .lr-line.active .lr-line-original {
					color: rgba(255,255,255,.80);
				}
				#lr-modal.lr-fullscreen .lr-line-romanized {
					font-size: clamp(1.55rem, 3.2vw, 2.75rem);
					font-weight: 700;
					letter-spacing: -.01em;
					line-height: 1.2;
					color: rgba(255,255,255,.28);
					transition: color .32s ease, text-shadow .32s ease;
				}
				#lr-modal.lr-fullscreen .lr-line.active .lr-line-romanized {
					color: #fff;
					text-shadow: 0 2px 32px rgba(255,255,255,.20);
				}

				/* ── Empty state ── */
				.lr-empty {
					font-size: 13px;
					color: rgba(255,255,255,.38);
					padding: 20px 14px;
					text-align: center;
					border: 1px dashed rgba(255,255,255,.12);
					border-radius: 12px;
					background: rgba(255,255,255,.04);
					margin: 12px 0;
				}
				#lr-modal.lr-fullscreen .lr-empty {
					color: rgba(255,255,255,.55);
					border-color: rgba(255,255,255,.15);
					background: rgba(0,0,0,.25);
					margin: 40px 28px;
					font-size: 15px;
				}

				/* ── Footer note ── */
				.lr-note {
					font-size: 10.5px;
					color: rgba(255,255,255,.25);
					padding: 6px 18px 12px;
					flex-shrink: 0;
					background: rgba(0,0,0,.12);
				}
				#lr-modal.lr-fullscreen .lr-note {
					color: rgba(255,255,255,.30);
					padding: 8px 28px 16px;
					background: rgba(0,0,0,.22);
				}

				/* ── Menu button — Apple Music pill style ── */
				.lr-menu-btn {
					display: inline-flex;
					align-items: center;
					gap: 7px;
					padding: 6px 13px 6px 10px;
					background: rgba(255,255,255,.07);
					border: 1px solid rgba(255,255,255,.10);
					border-radius: 999px;
					color: rgba(255,255,255,.80);
					font-size: 12.5px;
					font-weight: 500;
					cursor: pointer;
					font-family: -apple-system, "SF Pro Text", "Helvetica Neue", sans-serif;
					transition: background .15s ease, border-color .15s ease, color .15s ease;
					white-space: nowrap;
				}
				.lr-menu-btn:hover {
					background: rgba(255,255,255,.13);
					border-color: rgba(255,255,255,.20);
					color: #fff;
				}
				.lr-menu-btn svg { flex-shrink: 0; opacity: .85; }

				@media (max-width: 768px) {
					#lr-modal { max-width: 95vw; max-height: 88vh; }
					#lr-modal.lr-fullscreen .lr-body { padding: 15vh 0 22vh; }
					#lr-modal.lr-fullscreen .lr-line { padding: 5px 18px; }
					#lr-modal.lr-fullscreen .lr-line-romanized {
						font-size: clamp(1.25rem, 6.5vw, 2rem);
					}
				}
			`;
			document.head.appendChild(style);
		},

		createModal() {
			const overlay = document.createElement("div");
			overlay.id = "lr-overlay";
			overlay.onclick = () => this.close();

			const modal = document.createElement("div");
			modal.id = "lr-modal";
			modal.innerHTML = `
				<!-- Ambient background (fullscreen only) -->
				<div class="lr-ambient" id="lr-ambient">
					<div class="lr-ambient-img" id="lr-amb-1"></div>
					<div class="lr-ambient-img" id="lr-amb-2"></div>
					<div class="lr-ambient-overlay"></div>
				</div>

				<div class="lr-shell">
					<!-- Header -->
					<div class="lr-header">
						<img class="lr-artwork" id="lr-artwork" alt="" />
						<div class="lr-track-info">
							<div class="lr-title">Lyrics Romanization</div>
							<div class="lr-subtitle" id="lr-subtitle">No track loaded</div>
						</div>
						<div class="lr-header-actions">
							<!-- Fullscreen toggle -->
							<button class="lr-icon-btn" id="lr-fullscreen" title="Fullscreen" aria-label="Toggle fullscreen">
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
									<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/>
									<line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
								</svg>
							</button>
							<!-- Close -->
							<button class="lr-icon-btn" id="lr-close" aria-label="Close">
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
									<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
								</svg>
							</button>
						</div>
					</div>

					<!-- Controls -->
					<div class="lr-controls">
						<label class="lr-switch">
							<input type="checkbox" id="lr-enabled" />
							<span>Romanize</span>
						</label>
						<label class="lr-switch">
							<input type="checkbox" id="lr-show-original" />
							<span>Original</span>
						</label>
						<label class="lr-switch">
							<input type="checkbox" id="lr-auto-scroll" />
							<span>Auto-scroll</span>
						</label>
						<button class="lr-pill-btn" id="lr-refresh">↺ Refresh</button>
					</div>

					<!-- Lyrics -->
					<div class="lr-body-wrap">
						<div class="lr-body" id="lr-body"></div>
					</div>

					<div class="lr-note">Romanization: Korean Hangul · Japanese kana + kanji (online)</div>
				</div>
			`;

			document.body.appendChild(overlay);
			document.body.appendChild(modal);

			// Wire checkboxes
			const enabledEl = modal.querySelector("#lr-enabled");
			const showOrigEl = modal.querySelector("#lr-show-original");
			const autoScrEl = modal.querySelector("#lr-auto-scroll");
			enabledEl.checked = !!this.settings.enabled;
			showOrigEl.checked = !!this.settings.showOriginal;
			autoScrEl.checked = !!this.settings.autoScroll;

			enabledEl.onchange = async (e) => { this.settings.enabled = !!e.target.checked; await this.saveSettings(); this.renderLyrics(); };
			showOrigEl.onchange = async (e) => { this.settings.showOriginal = !!e.target.checked; await this.saveSettings(); this.renderLyrics(); };
			autoScrEl.onchange = async (e) => { this.settings.autoScroll = !!e.target.checked; await this.saveSettings(); };

			modal.querySelector("#lr-close").onclick = () => this.close();
			modal.querySelector("#lr-fullscreen").onclick = () => this.toggleFullscreen();
			modal.querySelector("#lr-refresh").onclick = async () => this.refreshLyrics();

			this._onKeydown = (ev) => {
				if (ev.key !== "Escape" || !this.isOpen) return;
				if (this.isFullscreen) { this.toggleFullscreen(false); return; }
				this.close();
			};
			document.addEventListener("keydown", this._onKeydown);
		},

		setFullscreenMode(enabled) {
			this.isFullscreen = !!enabled;
			const modal = document.getElementById("lr-modal");
			const btn   = document.getElementById("lr-fullscreen");
			if (!modal || !btn) return;

			modal.classList.toggle("lr-fullscreen", this.isFullscreen);
			btn.classList.toggle("active", this.isFullscreen);

			// Swap fullscreen icon
			btn.innerHTML = this.isFullscreen
				? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/>
						<line x1="10" y1="14" x2="3" y2="21"/><line x1="21" y1="3" x2="14" y2="10"/>
					</svg>`
				: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/>
						<line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
					</svg>`;

			// Overlay hidden in fullscreen (whole screen is modal)
			const overlay = document.getElementById("lr-overlay");
			if (overlay) overlay.style.display = this.isFullscreen ? "none" : "";
		},

		toggleFullscreen(nextState) {
			const enabled = typeof nextState === "boolean" ? nextState : !this.isFullscreen;
			this.setFullscreenMode(enabled);
			this.renderLyrics();
		},

		createMenuButton() {
			const button = document.createElement("button");
			button.className = "lr-menu-btn";
			button.innerHTML = `
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<path d="M9 18V5l12-2v13"/>
					<circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
				</svg>
				<span>Lyrics</span>
			`;
			button.onclick = () => this.open();
			this.api.ui.registerSlot("playerbar:menu", button);
		},

		open() {
			this.isOpen = true;
			document.getElementById("lr-overlay")?.classList.add("open");
			document.getElementById("lr-modal")?.classList.add("open");
			this.applyArtwork();
			this.setFullscreenMode(this.isFullscreen);
			this.renderLyrics();
		},

		close() {
			this.isOpen = false;
			this.setFullscreenMode(false);
			document.getElementById("lr-overlay")?.classList.remove("open");
			document.getElementById("lr-modal")?.classList.remove("open");
			// Restore overlay display
			const overlay = document.getElementById("lr-overlay");
			if (overlay) overlay.style.display = "";
		},

		cleanupUI() {
			this.api.ui.unregisterSlot("playerbar:menu");
			document.getElementById("lr-styles")?.remove();
			document.getElementById("lr-overlay")?.remove();
			document.getElementById("lr-modal")?.remove();
			if (this._onKeydown) {
				document.removeEventListener("keydown", this._onKeydown);
				this._onKeydown = null;
			}
		},

		async refreshLyrics() {
			try {
				const currentTrack = this.api.player?.getCurrentTrack?.() || null;
				this.currentTrackTitle  = currentTrack?.title  || this.currentTrackTitle  || "No track loaded";
				this.currentTrackArtist = currentTrack?.artist || "";
				this.currentTrackAlbum  = currentTrack?.album  || "";
				this.currentArtwork     = this.extractArtwork(currentTrack);
				this.applyArtwork();

				const lines = await this.api.lyrics.getCurrentTrackLyrics();
				this.lyrics = Array.isArray(lines) ? lines : [];
				this.romanizedLines = [];
				this.activeIndex = -1;
				this.lineCache.clear();
				await this.buildRomanizedLines();
				this.renderLyrics();
			} catch (e) {
				console.error("[LyricsRomanization] Failed to refresh lyrics:", e);
				this.lyrics = [];
				this.romanizedLines = [];
				this.activeIndex = -1;
				this.currentArtwork = "";
				this.applyArtwork();
				this.renderLyrics();
			}
		},

		extractArtwork(track) {
			if (!track || typeof track !== "object") return "";
			for (const key of ["cover_url","coverUrl","cover","artwork","thumbnail"]) {
				if (typeof track[key] === "string" && track[key].trim()) return track[key].trim();
			}
			return "";
		},

		applyArtwork() {
			const url = this.currentArtwork;

			// Header artwork img
			const img = document.getElementById("lr-artwork");
			if (img) {
				if (url) { img.src = url; img.classList.add("visible"); }
				else     { img.src = ""; img.classList.remove("visible"); }
			}

			// Ambient layers
			const cssUrl = url ? `url(${this.escapeCssUrl(url)})` : "none";
			const a1 = document.getElementById("lr-amb-1");
			const a2 = document.getElementById("lr-amb-2");
			if (a1) a1.style.backgroundImage = cssUrl;
			if (a2) a2.style.backgroundImage = cssUrl;
		},

		async buildRomanizedLines() {
			if (!this.settings.enabled || !Array.isArray(this.lyrics) || !this.lyrics.length) {
				this.romanizedLines = [];
				return;
			}
			const out = [];
			for (const line of this.lyrics) {
				out.push(await this.getRomanizedLine(String(line?.text ?? "")));
			}
			this.romanizedLines = out;
		},

		renderLyrics() {
			const subtitle = document.getElementById("lr-subtitle");
			const body     = document.getElementById("lr-body");
			if (!body) return;

			subtitle.textContent = this.buildSubtitle();

			if (!this.lyrics.length) {
				body.innerHTML = `<div class="lr-empty">No synced lyrics found for this track.</div>`;
				return;
			}

			const html = this.lyrics.map((line, index) => {
				const rawText    = String(line?.text ?? "");
				const safeOrig   = this.escapeHtml(rawText || " ");
				const romanized  = this.settings.enabled
					? (this.romanizedLines[index] ?? this.getRomanizedLineLocal(rawText))
					: rawText;
				const safeRom    = this.escapeHtml(romanized || " ");
				const isActive   = index === this.activeIndex;

				return `
					<div class="lr-line${isActive ? " active" : ""}" data-index="${index}">
						${this.settings.showOriginal ? `<div class="lr-line-original">${safeOrig}</div>` : ""}
						<div class="lr-line-romanized">${safeRom}</div>
					</div>`;
			}).join("");

			body.innerHTML = html;
		},

		updateActiveLine(currentTime) {
			if (!Array.isArray(this.lyrics) || !this.lyrics.length) return;
			const nextIndex = this.findActiveIndexByTime(currentTime, this.lyrics);
			if (nextIndex === this.activeIndex) return;

			const body = document.getElementById("lr-body");
			if (!body) { this.activeIndex = nextIndex; return; }

			body.querySelector(".lr-line.active")?.classList.remove("active");
			this.activeIndex = nextIndex;
			const curr = body.querySelector(`.lr-line[data-index="${this.activeIndex}"]`);
			if (curr) {
				curr.classList.add("active");
				if (this.isOpen && this.settings.autoScroll) {
					curr.scrollIntoView({ block: "center", behavior: "smooth" });
				}
			}
		},

		findActiveIndexByTime(time, lines) {
			let low = 0, high = lines.length - 1, result = -1;
			while (low <= high) {
				const mid = (low + high) >> 1;
				const t   = Number(lines[mid]?.time ?? 0);
				if (t <= time) { result = mid; low = mid + 1; }
				else           { high = mid - 1; }
			}
			return result;
		},

		async getRomanizedLine(text) {
			if (!text) return "";
			if (this.lineCache.has(text)) return this.lineCache.get(text);
			const result = await this.romanizeMultilingual(text);
			this.lineCache.set(text, result);
			return result;
		},

		getRomanizedLineLocal(text) {
			if (!text) return "";
			return this.sanitizeHybrid(this.romanizeJapanese(this.romanizeKorean(text)));
		},

		async romanizeMultilingual(text) {
			return await this.romanizeJapaneseSmart(this.romanizeKorean(text));
		},

		async romanizeJapaneseSmart(text) {
			if (!this.containsJapanese(text)) return text;
			const remote = await this.remoteRomanizeJapanese(text);
			// Use remote result but always run a second-pass to clean up
			// any leftover kana or kanji that Google didn't convert
			const base = (remote && remote !== text) ? remote : text;
			return this.sanitizeHybrid(base);
		},

		// Second-pass: converts any remaining kana char-by-char and strips
		// leftover CJK characters (kanji the API failed to transliterate).
		sanitizeHybrid(text) {
			// First apply our kana romanizer over whatever remains
			const kanaPass = this.romanizeJapanese(text);
			// Then remove any CJK characters that still couldn't be converted
			// (kanji with no kana reading available locally)
			return kanaPass.replace(/[\u3400-\u9fff\u4e00-\u9fff\uf900-\ufaff]/g, "");
		},

		containsJapanese(text) { return /[\u3040-\u30ff\u3400-\u9fff\u4e00-\u9fff]/.test(String(text)); },
		containsCjk(text)      { return /[\u3400-\u9fff\u4e00-\u9fff]/.test(String(text)); },

		isUsefulRomanization(candidate, original) {
			if (!candidate) return false;
			const v = String(candidate).trim();
			if (!v || !/[a-zA-Z]/.test(v)) return false;
			// Allow hybrid results (they'll be cleaned by sanitizeHybrid)
			if (v === String(original).trim()) return false;
			return true;
		},

		parseGoogleRomanizationPayload(payload) {
			if (!payload) return "";
			if (typeof payload === "object" && Array.isArray(payload.sentences)) {
				const t = payload.sentences.map(s => (s && typeof s.trans === "string" ? s.trans : "")).join("").trim();
				if (t) return t;
			}
			if (Array.isArray(payload) && Array.isArray(payload[0])) {
				const t = payload[0].map(s => (Array.isArray(s) && typeof s[0] === "string" ? s[0] : "")).join("").trim();
				if (t) return t;
			}
			return "";
		},

		async remoteRomanizeJapanese(text) {
			if (!text || !this.api.fetch) return "";
			if (this.remoteJaCache[text]) return this.remoteJaCache[text];
			try {
				const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ja&tl=ja-Latn&dt=t&dj=1&q=${encodeURIComponent(text)}`;
				const res = await this.api.fetch(url);
				if (!res?.ok) return "";
				const payload   = await res.json();
				const candidate = this.parseGoogleRomanizationPayload(payload);
				if (!this.isUsefulRomanization(candidate, text)) return "";
				this.remoteJaCache[text] = candidate;
				this.scheduleRemoteCacheSave();
				return candidate;
			} catch { return ""; }
		},

		romanizeKorean(text) {
			let out = "";
			for (const ch of String(text)) {
				const code = ch.charCodeAt(0);
				if (code < 0xac00 || code > 0xd7a3) { out += ch; continue; }
				const si  = code - 0xac00;
				const cho = Math.floor(si / 588);
				const jung = Math.floor((si % 588) / 28);
				const jong = si % 28;
				out += CHOSEONG_RR[cho] + JUNGSEONG_RR[jung] + JONGSEONG_RR[jong];
			}
			return out;
		},

		romanizeJapanese(text) {
			const src = this.toHiragana(String(text));
			let out = "";
			for (let i = 0; i < src.length; i++) {
				const ch   = src[i];
				const pair = src.slice(i, i + 2);
				if (ch === "っ") {
					const nr = this.peekRomaji(src, i + 1);
					if (nr && /^[bcdfghjklmnpqrstvwxyz]/.test(nr)) out += nr[0];
					continue;
				}
				if (pair.length === 2 && DIGRAPH_MAP[pair]) { out += DIGRAPH_MAP[pair]; i++; continue; }
				if (ch === "ー") { const v = this.lastVowel(out); if (v) out += v; continue; }
				if (ch === "ん") {
					const nr = this.peekRomaji(src, i + 1);
					out += (nr && /^[aiueoy]/.test(nr)) ? "n'" : "n";
					continue;
				}
				out += KANA_MAP[ch] ?? ch;
			}
			return out;
		},

		peekRomaji(src, index) {
			if (index >= src.length) return "";
			const pair = src.slice(index, index + 2);
			if (DIGRAPH_MAP[pair]) return DIGRAPH_MAP[pair];
			const ch = src[index];
			if (ch === "っ") return this.peekRomaji(src, index + 1);
			if (ch === "ん") return "n";
			return KANA_MAP[ch] ?? "";
		},

		lastVowel(str) {
			for (let i = str.length - 1; i >= 0; i--) {
				if (/[aeiou]/.test(str[i])) return str[i];
			}
			return "";
		},

		toHiragana(input) {
			return input.replace(/[\u30A1-\u30F6]/g, k => String.fromCharCode(k.charCodeAt(0) - 0x60));
		},

		buildSubtitle() {
			if (!this.currentTrackTitle) return "No track loaded";
			const parts = [this.currentTrackTitle];
			if (this.currentTrackArtist) parts.push(this.currentTrackArtist);
			if (this.currentTrackAlbum)  parts.push(this.currentTrackAlbum);
			return parts.join(" · ");
		},

		escapeCssUrl(value) { return String(value).replace(/["\\)]/g, "\\$&"); },

		escapeHtml(value) {
			return String(value)
				.replace(/&/g, "&amp;").replace(/</g, "&lt;")
				.replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
		},
	};

	/* ── Tables ── */
	const KANA_MAP = {
		あ:"a",い:"i",う:"u",え:"e",お:"o",
		か:"ka",き:"ki",く:"ku",け:"ke",こ:"ko",
		さ:"sa",し:"shi",す:"su",せ:"se",そ:"so",
		た:"ta",ち:"chi",つ:"tsu",て:"te",と:"to",
		な:"na",に:"ni",ぬ:"nu",ね:"ne",の:"no",
		は:"ha",ひ:"hi",ふ:"fu",へ:"he",ほ:"ho",
		ま:"ma",み:"mi",む:"mu",め:"me",も:"mo",
		や:"ya",ゆ:"yu",よ:"yo",
		ら:"ra",り:"ri",る:"ru",れ:"re",ろ:"ro",
		わ:"wa",を:"o",ん:"n",
		が:"ga",ぎ:"gi",ぐ:"gu",げ:"ge",ご:"go",
		ざ:"za",じ:"ji",ず:"zu",ぜ:"ze",ぞ:"zo",
		だ:"da",ぢ:"ji",づ:"zu",で:"de",ど:"do",
		ば:"ba",び:"bi",ぶ:"bu",べ:"be",ぼ:"bo",
		ぱ:"pa",ぴ:"pi",ぷ:"pu",ぺ:"pe",ぽ:"po",
		ぁ:"a",ぃ:"i",ぅ:"u",ぇ:"e",ぉ:"o",ゔ:"vu",
	};

	const DIGRAPH_MAP = {
		きゃ:"kya",きゅ:"kyu",きょ:"kyo",
		しゃ:"sha",しゅ:"shu",しょ:"sho",
		ちゃ:"cha",ちゅ:"chu",ちょ:"cho",
		にゃ:"nya",にゅ:"nyu",にょ:"nyo",
		ひゃ:"hya",ひゅ:"hyu",ひょ:"hyo",
		みゃ:"mya",みゅ:"myu",みょ:"myo",
		りゃ:"rya",りゅ:"ryu",りょ:"ryo",
		ぎゃ:"gya",ぎゅ:"gyu",ぎょ:"gyo",
		じゃ:"ja",じゅ:"ju",じょ:"jo",
		ぢゃ:"ja",ぢゅ:"ju",ぢょ:"jo",
		びゃ:"bya",びゅ:"byu",びょ:"byo",
		ぴゃ:"pya",ぴゅ:"pyu",ぴょ:"pyo",
		うぁ:"wa",うぃ:"wi",うぇ:"we",うぉ:"wo",
		てぃ:"ti",でぃ:"di",とぅ:"tu",どぅ:"du",
		ふぁ:"fa",ふぃ:"fi",ふぇ:"fe",ふぉ:"fo",
		つぁ:"tsa",つぃ:"tsi",つぇ:"tse",つぉ:"tso",
		しぇ:"she",じぇ:"je",ちぇ:"che",
	};

	const CHOSEONG_RR  = ["g","kk","n","d","tt","r","m","b","pp","s","ss","","j","jj","ch","k","t","p","h"];
	const JUNGSEONG_RR = ["a","ae","ya","yae","eo","e","yeo","ye","o","wa","wae","oe","yo","u","wo","we","wi","yu","eu","ui","i"];
	const JONGSEONG_RR = ["","k","k","ks","n","nj","nh","t","l","lk","lm","lb","ls","lt","lp","lh","m","p","ps","t","t","ng","t","t","k","t","p","t"];

	if (typeof Audion !== "undefined" && Audion.register) {
		Audion.register(LyricsRomanization);
	} else {
		window.LyricsRomanization = LyricsRomanization;
		window.AudionPlugin        = LyricsRomanization;
	}
})();