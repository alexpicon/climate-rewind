"""Hard USD budget for Anthropic API runs, metered from the API's own `usage` fields.

MeteredClient wraps an Anthropic client. Before each messages.create() it reserves a worst-case cost for that call
(the request size in tokens, estimated at 3 characters per token, plus max_tokens of output) and raises BudgetExceeded
if spent + reserve would pass the cap. After the call it books the real usage (input, output, cache write, cache read).
The ledger is a JSON file, so one budget can span several runs (e.g. four states) and survives a crash.

Prices are an ASSUMPTION (Sonnet-tier list price) and are not verified for claude-sonnet-5-5; see detective.PRICE_IN.
"""
from __future__ import annotations

import json
import os
import threading


class BudgetExceeded(RuntimeError):
    pass


class Ledger:
    def __init__(self, path: str | None, budget_usd: float, price_in: float, price_out: float):
        self.path, self.budget = path, float(budget_usd)
        self.price_in, self.price_out = price_in, price_out
        self.lock = threading.Lock()
        self.reserved = 0.0
        self.t = dict(calls=0, input_tokens=0, output_tokens=0, cache_creation_input_tokens=0, cache_read_input_tokens=0)
        if path and os.path.exists(path):
            saved = json.load(open(path))
            for k in self.t:
                self.t[k] = int(saved.get(k, 0))

    def cost(self, t: dict | None = None) -> float:
        t = t or self.t
        return (t["input_tokens"] * self.price_in + t["cache_creation_input_tokens"] * self.price_in * 1.25
                + t["cache_read_input_tokens"] * self.price_in * 0.1 + t["output_tokens"] * self.price_out) / 1e6

    def reserve(self, usd: float) -> None:
        with self.lock:
            if self.cost() + self.reserved + usd > self.budget:
                raise BudgetExceeded(f"budget ${self.budget:.2f} would be exceeded: spent ${self.cost():.4f}, "
                                     f"in flight ${self.reserved:.4f}, next call up to ${usd:.4f}")
            self.reserved += usd

    def book(self, usd_reserved: float, usage) -> None:
        with self.lock:
            self.reserved = max(0.0, self.reserved - usd_reserved)
            self.t["calls"] += 1
            for k in ("input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"):
                self.t[k] += int(getattr(usage, k, 0) or 0) if usage is not None else 0
            self._save()

    def release(self, usd_reserved: float) -> None:
        with self.lock:
            self.reserved = max(0.0, self.reserved - usd_reserved)

    def _save(self) -> None:
        if not self.path:
            return
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        tmp = self.path + ".tmp"
        json.dump(dict(self.t, spent_usd=round(self.cost(), 4), budget_usd=self.budget,
                       price_assumption=f"${self.price_in}/M in, ${self.price_out}/M out (unverified)"), open(tmp, "w"))
        os.replace(tmp, self.path)

    def summary(self) -> dict:
        with self.lock:
            return dict(self.t, spent_usd=round(self.cost(), 4), budget_usd=self.budget)


class _Messages:
    def __init__(self, outer):
        self.outer = outer

    def create(self, **kw):
        led = self.outer.ledger
        req_chars = len(json.dumps([kw.get("system"), kw.get("tools"), kw.get("messages")], default=str))
        worst = (req_chars / 3.0 * led.price_in + int(kw.get("max_tokens", 1024)) * led.price_out) / 1e6
        led.reserve(worst)
        try:
            resp = self.outer.inner.messages.create(**kw)
        except BaseException:
            led.release(worst)
            raise
        led.book(worst, getattr(resp, "usage", None))
        return resp


class MeteredClient:
    def __init__(self, inner, ledger: Ledger):
        self.inner, self.ledger = inner, ledger
        self.messages = _Messages(self)
