(() => {
	function bootTmuxOrchestrator() {
		const app = document.querySelector('#tmux-app');
		if (!app) return;

		const apiUrl = app.dataset.apiUrl;
		const storageKey = 'tmux-pi-orchestrator.view.v1';
		const visibleRefreshMs = 1000;
		const hiddenRefreshMs = 10000;
		let csrf = app.dataset.csrf || '';
		let selectedSession = '';
		let selectedTarget = '';
		let timer = null;
		let lastContent = '';

		try {
			const stored = JSON.parse(localStorage.getItem(storageKey) || '{}');
			selectedSession = String(stored.session || '');
			selectedTarget = String(stored.target || '');
		} catch (_) {
			selectedSession = '';
			selectedTarget = '';
		}

		const els = {
			status: app.querySelector('[data-status]'),
			sessions: app.querySelector('[data-sessions]'),
			output: app.querySelector('[data-output]'),
			paneSelect: app.querySelector('[data-pane-select]'),
			title: app.querySelector('[data-current-title]'),
			meta: app.querySelector('[data-current-meta]'),
			form: app.querySelector('[data-send-form]'),
			input: app.querySelector('[data-input]'),
			enter: app.querySelector('[data-send-enter]'),
			auto: app.querySelector('[data-auto-refresh]'),
			refresh: app.querySelector('[data-refresh]'),
			dialog: app.querySelector('[data-create-dialog]'),
			createForm: app.querySelector('[data-create-form]')
		};

		function rememberView() {
			try {
				localStorage.setItem(storageKey, JSON.stringify({ session: selectedSession, target: selectedTarget }));
			} catch (_) {}
		}

		function setStatus(message, error = false) {
			els.status.textContent = message;
			els.status.classList.toggle('error', error);
		}

		function autoRefreshDelay() {
			return document.hidden ? hiddenRefreshMs : visibleRefreshMs;
		}

		function scheduleAutoRefresh() {
			if (timer) clearInterval(timer);
			timer = els.auto.checked ? setInterval(refresh, autoRefreshDelay()) : null;
		}

		function escapeHtml(text) {
			return String(text).replace(/[&<>"']/g, (char) => ({
				'&': '&amp;',
				'<': '&lt;',
				'>': '&gt;',
				'"': '&quot;',
				"'": '&#39;'
			}[char]));
		}

		function ansi256Color(code) {
			const value = Number(code);
			if (!Number.isFinite(value) || value < 0 || value > 255) return null;
			const base = [
				[0, 0, 0], [128, 0, 0], [0, 128, 0], [128, 128, 0],
				[0, 0, 128], [128, 0, 128], [0, 128, 128], [192, 192, 192],
				[128, 128, 128], [255, 0, 0], [0, 255, 0], [255, 255, 0],
				[0, 0, 255], [255, 0, 255], [0, 255, 255], [255, 255, 255]
			];
			if (value < 16) return `rgb(${base[value].join(',')})`;
			if (value < 232) {
				const n = value - 16;
				const r = Math.floor(n / 36);
				const g = Math.floor((n % 36) / 6);
				const b = n % 6;
				const scale = (v) => v === 0 ? 0 : 55 + (v * 40);
				return `rgb(${scale(r)},${scale(g)},${scale(b)})`;
			}
			const gray = 8 + ((value - 232) * 10);
			return `rgb(${gray},${gray},${gray})`;
		}

		function styleToCss(state) {
			let fg = state.fg;
			let bg = state.bg;
			if (state.reverse) [fg, bg] = [bg || '#d1fae5', fg || '#020617'];
			const decorations = [];
			const styles = [];
			if (state.bold) styles.push('font-weight:700');
			if (state.dim) styles.push('opacity:.72');
			if (state.italic) styles.push('font-style:italic');
			if (state.underline) decorations.push('underline');
			if (state.strike) decorations.push('line-through');
			if (decorations.length) styles.push(`text-decoration:${decorations.join(' ')}`);
			if (fg) styles.push(`color:${fg}`);
			if (bg) styles.push(`background-color:${bg}`);
			return styles.join(';');
		}

		function resetStyle(state) {
			Object.assign(state, {
				bold: false,
				dim: false,
				italic: false,
				underline: false,
				strike: false,
				reverse: false,
				fg: '',
				bg: ''
			});
		}

		function applySgr(state, rawCodes) {
			const normal = ['#0f172a', '#ef4444', '#22c55e', '#eab308', '#3b82f6', '#d946ef', '#06b6d4', '#e5e7eb'];
			const bright = ['#64748b', '#f87171', '#4ade80', '#facc15', '#60a5fa', '#e879f9', '#22d3ee', '#ffffff'];
			const codes = rawCodes.flatMap((code) => String(code).split(':')).filter((code) => code !== '');
			if (!codes.length) codes.push('0');
			for (let i = 0; i < codes.length; i++) {
				const code = Number(codes[i]);
				if (!Number.isFinite(code)) continue;
				if (code === 0) resetStyle(state);
				else if (code === 1) state.bold = true;
				else if (code === 2) state.dim = true;
				else if (code === 3) state.italic = true;
				else if (code === 4) state.underline = true;
				else if (code === 7) state.reverse = true;
				else if (code === 9) state.strike = true;
				else if (code === 22) { state.bold = false; state.dim = false; }
				else if (code === 23) state.italic = false;
				else if (code === 24) state.underline = false;
				else if (code === 27) state.reverse = false;
				else if (code === 29) state.strike = false;
				else if (code === 39) state.fg = '';
				else if (code === 49) state.bg = '';
				else if (code >= 30 && code <= 37) state.fg = normal[code - 30];
				else if (code >= 90 && code <= 97) state.fg = bright[code - 90];
				else if (code >= 40 && code <= 47) state.bg = normal[code - 40];
				else if (code >= 100 && code <= 107) state.bg = bright[code - 100];
				else if ((code === 38 || code === 48) && Number(codes[i + 1]) === 5) {
					const color = ansi256Color(codes[i + 2]);
					if (color) state[code === 38 ? 'fg' : 'bg'] = color;
					i += 2;
				} else if ((code === 38 || code === 48) && Number(codes[i + 1]) === 2) {
					const rgb = codes.slice(i + 2, i + 5).map(Number);
					if (rgb.length === 3 && rgb.every((value) => Number.isFinite(value) && value >= 0 && value <= 255)) {
						state[code === 38 ? 'fg' : 'bg'] = `rgb(${rgb.join(',')})`;
					}
					i += 4;
				}
			}
		}

		function appendStyled(html, text, state) {
			if (text === '') return html;
			const css = styleToCss(state);
			return html + (css ? `<span style="${css}">${escapeHtml(text)}</span>` : escapeHtml(text));
		}

		function renderTerminalContent(content) {
			const text = String(content || 'No output captured.')
				.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
				.replace(/\r\n/g, '\n')
				.replace(/\r/g, '\n');
			const state = {};
			resetStyle(state);
			const pattern = /\x1b\[([?0-9;:]*)((?: |\?)?[@-~])/g;
			let html = '';
			let lastIndex = 0;
			let match;
			while ((match = pattern.exec(text))) {
				html = appendStyled(html, text.slice(lastIndex, match.index), state);
				const final = match[2].slice(-1);
				if (final === 'm') applySgr(state, match[1].split(';'));
				lastIndex = pattern.lastIndex;
			}
			html = appendStyled(html, text.slice(lastIndex), state);
			return html;
		}

		async function request(action, payload = {}, method = 'GET') {
			const options = { method, headers: {} };
			let url = apiUrl;
			if (method === 'GET') {
				const params = new URLSearchParams({ action, ...payload });
				url += (url.includes('?') ? '&' : '?') + params.toString();
			} else {
				options.headers['Content-Type'] = 'application/json';
				options.headers['X-CSRF-Token'] = csrf;
				options.body = JSON.stringify({ action, csrf, ...payload });
			}
			const response = await fetch(url, options);
			const data = await response.json();
			if (data.csrf) csrf = data.csrf;
			if (!data.ok) throw new Error(data.error || `Request failed (${response.status})`);
			return data;
		}

		function renderSessions(sessions) {
			els.sessions.innerHTML = '';
			if (!sessions.length) {
				els.sessions.innerHTML = '<p class="hint">No tmux sessions yet. Create one to start.</p>';
				return;
			}
			for (const session of sessions) {
				const card = document.createElement('button');
				card.type = 'button';
				card.className = 'session-card' + (session.name === selectedSession ? ' active' : '');
				card.innerHTML = `<span class="kill" title="Kill session">×</span><strong></strong><span></span>`;
				card.querySelector('strong').textContent = session.name;
				card.querySelector('span:last-child').textContent = `${session.windows} window(s), ${session.attached} attached`;
				card.addEventListener('click', async (event) => {
					if (event.target.classList.contains('kill')) {
						if (confirm(`Kill tmux session ${session.name}?`)) {
							await request('kill-session', { name: session.name }, 'POST');
							selectedSession = '';
							selectedTarget = '';
							rememberView();
							await refresh();
						}
						return;
					}
					selectedSession = session.name;
					selectedTarget = '';
					lastContent = '';
					els.title.textContent = session.name;
					els.meta.textContent = 'Loading first pane…';
					els.output.textContent = 'Loading first pane…';
					rememberView();
					await refresh();
				});
				els.sessions.appendChild(card);
			}
		}

		function renderPanes(panes) {
			els.paneSelect.innerHTML = '';
			for (const pane of panes) {
				const option = document.createElement('option');
				option.value = pane.target;
				option.textContent = `${pane.target} · ${pane.command} · ${pane.path}`;
				option.selected = pane.target === selectedTarget;
				els.paneSelect.appendChild(option);
			}
			els.paneSelect.disabled = panes.length === 0;
		}

		async function refresh() {
			try {
				const data = await request('snapshot', { session: selectedSession, target: selectedTarget, lines: 220 });
				selectedSession = data.selected_session || '';
				selectedTarget = data.selected_target || '';
				rememberView();
				renderSessions(data.sessions || []);
				renderPanes(data.panes || []);
				const content = data.capture?.content || '';
				els.title.textContent = selectedTarget || 'No pane selected';
				els.meta.textContent = selectedSession ? `Session: ${selectedSession}` : 'Create or select a tmux session.';
				if (content !== lastContent) {
					els.output.innerHTML = renderTerminalContent(content);
					els.output.scrollTop = els.output.scrollHeight;
					lastContent = content;
				}
				setStatus(`Updated ${new Date().toLocaleTimeString()}`);
			} catch (error) {
				setStatus(error.message, true);
			}
		}

		els.paneSelect.addEventListener('change', () => {
			selectedTarget = els.paneSelect.value;
			lastContent = '';
			rememberView();
			refresh();
		});
		els.refresh.addEventListener('click', refresh);
		els.auto.addEventListener('change', scheduleAutoRefresh);
		document.addEventListener('visibilitychange', scheduleAutoRefresh);
		els.form.addEventListener('submit', async (event) => {
			event.preventDefault();
			if (!selectedTarget || !els.input.value) return;
			try {
				await request('send', { target: selectedTarget, text: els.input.value, enter: els.enter.checked ? 1 : 0 }, 'POST');
				els.input.value = '';
				await refresh();
			} catch (error) {
				setStatus(error.message, true);
			}
		});
		els.input.addEventListener('keydown', (event) => {
			if (event.key === 'Enter' && !event.shiftKey) {
				event.preventDefault();
				els.form.requestSubmit();
			}
		});
		app.querySelector('[data-open-create]').addEventListener('click', () => els.dialog.showModal());
		app.querySelector('[data-close-create]').addEventListener('click', () => els.dialog.close());
		els.createForm.addEventListener('submit', async (event) => {
			event.preventDefault();
			const form = new FormData(els.createForm);
			try {
				await request('create-session', { name: form.get('name'), command: form.get('command') }, 'POST');
				selectedSession = String(form.get('name') || '');
				selectedTarget = '';
				rememberView();
				els.dialog.close();
				els.createForm.reset();
				await refresh();
			} catch (error) {
				setStatus(error.message, true);
			}
		});

		refresh();
		scheduleAutoRefresh();
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', bootTmuxOrchestrator, { once: true });
	} else {
		bootTmuxOrchestrator();
	}
})();
