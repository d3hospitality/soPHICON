"""Drive the real enkiRIDION app against the mock Even bridge.

    from g2 import Session
    with Session(tier='seeker') as s:
        s.lens('home'); s.click(); s.lens('speak')

Server responses are faked with Playwright routes, so every account state
(anonymous, linked Seeker, linked Sage) and every refusal (401/403/429)
can be reproduced without touching production.
"""
import json, os, time
from playwright.sync_api import sync_playwright

BASE = os.environ.get('G2_BASE', 'http://localhost:5199/')
OUT = os.environ.get('G2_OUT', os.path.join(os.path.dirname(__file__), 'shots'))
API = 'https://sophicon-api.vercel.app'
IPHONE_UA = ('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 '
             '(KHTML, like Gecko) Mobile/15E148')

REPLY = ("A good question is a lamp, not a map. Before you decide, ask which choice "
         "you could explain to your future self without lowering your eyes. "
         "Begin there; the rest is weather.")


class Session:
    def __init__(self, tier='anon', speak=None, transcribe='Should I take the job?', seed=None, url_extra=''):
        """tier: anon | seeker | sage.  speak: dict(status, body) to force a speak response."""
        self.tier, self.speak_override, self.transcript = tier, speak, transcribe
        self.seed, self.url_extra = seed or {}, url_extra
        self.calls = []
        os.makedirs(OUT, exist_ok=True)

    # ── lifecycle ──────────────────────────────────────────────────
    def __enter__(self):
        self._pw = sync_playwright().start()
        self.browser = self._pw.chromium.launch()
        self.ctx = self.browser.new_context(viewport={'width': 390, 'height': 844}, user_agent=IPHONE_UA,
                                            has_touch=True, is_mobile=True, device_scale_factor=2)
        self.page = self.ctx.new_page()
        self.logs = []
        self.page.on('console', lambda m: self.logs.append(f'{m.type}: {m.text}'))
        self.page.on('pageerror', lambda e: self.logs.append(f'PAGEERROR: {e}'))
        seed = dict(self.seed)
        if self.tier in ('seeker', 'sage'):
            seed.update({'enki_token': 'tok-' + self.tier, 'enki_handle': 'romario', 'enki_tier': self.tier})
        script = ''.join(f"localStorage.setItem({json.dumps('g2mock:' + k)}, {json.dumps(v)});" for k, v in seed.items())
        self.page.add_init_script(f"if (!sessionStorage.getItem('seeded')) {{ {script} sessionStorage.setItem('seeded','1'); }}")
        self._routes()
        self.page.goto(BASE + ('?' + self.url_extra if self.url_extra else ''), wait_until='networkidle', timeout=90000)
        self.settle(1500)
        return self

    def __exit__(self, *exc):
        self.browser.close(); self._pw.stop()

    # ── fake server ───────────────────────────────────────────────
    def _routes(self):
        p = self.page
        p.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(body='', content_type='text/css'))
        p.route('https://fonts.gstatic.com/**', lambda r: r.fulfill(status=404, body=''))
        p.route('https://afdrjzhcfltsngyxaqhb.supabase.co/**', lambda r: r.fulfill(json=[]))

        def api(route):
            req = route.request
            path = req.url.split(API, 1)[1].split('?')[0]
            auth = req.headers.get('authorization', '')
            self.calls.append((req.method, path, auth[:20]))
            body = {}
            try: body = req.post_data_json or {}
            except Exception: pass
            if path == '/api/me':
                if not auth: return route.fulfill(status=401, json={'error': 'unauthorized'})
                return route.fulfill(json={'handle': 'romario', 'tier': self.tier})
            if path == '/api/glasses-link':
                code = (body.get('code') or '').upper()
                if code == 'GOOD42':
                    return route.fulfill(json={'token': 'tok-sage', 'handle': 'romario', 'tier': 'sage'})
                return route.fulfill(status=400, json={'error': 'invalid_code'})
            if path == '/api/transcribe':
                return route.fulfill(json={'text': self.transcript})
            if path == '/api/speak':
                if self.speak_override:
                    o = self.speak_override
                    return route.fulfill(status=o.get('status', 200), json=o.get('body', {}))
                persona = (body.get('persona') or {}).get('name', '')
                if self.tier != 'sage' and persona and persona != 'Enki':
                    return route.fulfill(status=403, json={'error': 'sage_required', 'feature': 'speak_all_philosophers'})
                return route.fulfill(json={'text': REPLY, 'emotion': 'teaching', 'userMood': 'curious'})
            if path.startswith('/api/aphorica'):
                mk = lambda i, h, t, tier: {'id': i, 'text': t, 'tradition': 'Stoicism', 'emotion': 'resolve', 'rarity': 'rare',
                                            'stars': 3, 'upvotes': 4, 'downvotes': 0, 'createdAt': '2026-10-05T12:00:00Z',
                                            'author': {'handle': h, 'tier': tier, 'spritePath': None, 'values': []}, 'myVote': 0}
                return route.fulfill(json={'posts': [
                    mk(1, 'lyra', 'The obstacle is the tuition.', 'sage'),
                    mk(2, 'tomas', 'Water does not hurry, yet everything is reached.', 'seeker'),
                    mk(3, 'lyra', 'Rest is part of the climb.', 'sage'),
                ]})
            return route.fulfill(json={})
        p.route(API + '/**', api)

    # ── input ─────────────────────────────────────────────────────
    def settle(self, ms=700):
        self.page.wait_for_timeout(ms)

    def click(self, ms=900):   self.page.evaluate('__g2.click()'); self.settle(ms)
    def double(self, ms=900):  self.page.evaluate('__g2.double()'); self.settle(ms)
    def down(self, n=1, ms=350):
        for _ in range(n): self.page.evaluate("__g2.scroll('down')"); self.settle(ms)
    def up(self, n=1, ms=350):
        for _ in range(n): self.page.evaluate("__g2.scroll('up')"); self.settle(ms)
    def menu(self):            return self.page.evaluate('__g2.menu()')
    def pick(self, item_id, ms=900): self.page.evaluate(f'__g2.pick({item_id})'); self.settle(ms)
    def audio(self, seconds=1.0):
        frame = [0] * 3200
        for _ in range(int(seconds * 10)): self.page.evaluate(f'__g2.audio({json.dumps(frame)})')

    # ── inspection ────────────────────────────────────────────────
    def texts(self):      return self.page.evaluate('__g2.texts()')
    def items(self):      return self.page.evaluate('__g2.items()')
    def violations(self): return self.page.evaluate('__g2.state.violations')
    def overflow(self):   return self.page.evaluate('__g2.overflow')
    def glass_log(self):  return self.page.evaluate('__g2.state.log')

    def lens(self, name):
        self.page.evaluate('__g2.show()')
        self.page.locator('#g2-lens').screenshot(path=f'{OUT}/lens_{name}.png')
        self.page.evaluate('__g2.hide()')
        return f'{OUT}/lens_{name}.png'

    def phone(self, name, full=False):
        self.page.screenshot(path=f'{OUT}/phone_{name}.png', full_page=full)
        return f'{OUT}/phone_{name}.png'
