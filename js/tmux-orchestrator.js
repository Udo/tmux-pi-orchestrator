(() => {
	function bootTmuxOrchestrator() {
	const app = document.querySelector('#tmux-app');
	if (!app) return;

	const apiUrl = app.dataset.apiUrl;
	let csrf = app.dataset.csrf || '';
	let selectedSession = '';
	let selectedTarget = '';
	let timer = null;
	let lastContent = '';

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

	function setStatus(message, error = false) {
		els.status.textContent = message;
		els.status.classList.toggle('error', error);
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
		const styles = [];
		if (state.bold) styles.push('font-weight:700');
		if (state.dim) styles.push('opacity:.72');
		if (state.italic) styles.push('font-style:italic');
		if (state.underline) styles.push('text-decoration:underline');
		if (state.fg) styles.push(`color:${state.fg}`);
		if (state.bg) styles.push(`background-color:${state.bg}`);
		return styles.join(';');
	}

	function applySgr(state, codes) {
		const normalFg = ['#0f172a', '#ef4444', '#22c55e', '#eab308', '#3b82f6', '#d946ef', '#06b6d4', '#e5e7eb'];
		const brightFg = ['#64748b', '#f87171', '#4ade80', '#facc15', '#60a5fa', '#e879f9', '#22d3ee', '#ffffff'];
		if (!codes.length) codes = [0];
		for (let i = 0; i < codes.length; i++) {
			const code = Number(codes[i] || 0);
			if (code === 0) Object.assign(state, { bold: false, dim: false, italic: false, underline: false, reverse: false, fg: '', bg: '' });
			else if (code === 1) state.bold = true;
			else if (code === 2) state.dim = true;
			else if (code === 3) state.italic = true;
			else if (code === 4) state.underline = true;
			else if (code === 22) { state.bold = false; state.dim = false; }
			else if (code === 23) state.italic = false;
			else if (code === 24) state.underline = false;
			else if (code === 39) state.fg = '';
			else if (code === 49) state.bg = '';
			else if (code >= 30 && code <= 37) state.fg = normalFg[code - 30];
			else if (code >= 90 && code <= 97) state.fg = brightFg[code - 90];
			else if (code >= 40 && code <= 47) state.bg = normalFg[code - 40];
			else if (code >= 100 && code <= 107) state.bg = brightFg[code - 100];
			else if ((code === 38 || code === 48) && codes[i + 1] === '5') {
				const color = ansi256Color(codes[i + 2]);
				if (color) state[code === 38 ? 'fg' : 'bg'] = color;
				i += 2;
			} else if ((code === 38 || code === 48) && codes[i + 1] === '2') {
				const rgb = codes.slice(i + 2, i + 5).map(Number);
				if (rgb.length === 3 && rgb.every((v) => Number.isFinite(v) && v >= 0 && v <= 255)) {
					state[code === 38 ? 'fg' : 'bg'] = `rgb(${rgb.join(',')})`;
				}
				i += 4;
			}
		}
	}

	function renderTerminalContent(content) {
		let text = String(content || 'No output captured.')
			.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
			.replace(/\r\n/g, '\n')
			.replace(/\r/g, '\n');
		const state = { bold: false, dim: false, italic: false, underline: false, fg: '', bg: '' };
		const pattern = /\x1b\[([0-9;]*)m/g;
		let html = '';
		let lastIndex = 0;
		let match;
		while ((match = pattern.exec(text))) {
			const chunk = text.slice(lastIndex, match.index);
			const css = styleToCss(state);
			html += css ? `<span style="${css}">${escapeHtml(chunk)}</span>` : escapeHtml(chunk);
			applySgr(state, match[1] === '' ? [0] : match[1].split(';'));
			lastIndex = pattern.lastIndex;
		}
		const tail = text.slice(lastIndex).replace(/\x1b\[[?0-9;]*[A-Za-z]/g, '');
		const css = styleToCss(state);
		html += css ? `<span style="${css}">${escapeHtml(tail)}</span>` : escapeHtml(tail);
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
						await refresh();
					}
					return;
				}
				selectedSession = session.name;
				selectedTarget = '';
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
		refresh();
	});
	els.refresh.addEventListener('click', refresh);
	els.auto.addEventListener('change', () => {
		if (timer) clearInterval(timer);
		timer = els.auto.checked ? setInterval(refresh, 2500) : null;
	});
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
			els.dialog.close();
			els.createForm.reset();
			await refresh();
		} catch (error) {
			setStatus(error.message, true);
		}
	});

	refresh();
	timer = setInterval(refresh, 2500);
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', bootTmuxOrchestrator, { once: true });
	} else {
		bootTmuxOrchestrator();
	}
})();
