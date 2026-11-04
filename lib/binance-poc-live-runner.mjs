import fs from 'node:fs';
import path from 'node:path';
import {findPocLiveSetup, pocQuoteTransition, POC_LIVE_POLICY} from './poc-live-policy.mjs';

const sides = ['LONG', 'SHORT'];
const active = new Set(['WAITING', 'EXECUTING', 'UNKNOWN']);
const key = (side, symbol) => `${side}:${symbol}`;
const positive = x => Number.isFinite(Number(x)) && Number(x) > 0;

function saveAtomic(file, state) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const temp = `${file}.tmp`, fd = fs.openSync(temp, 'w', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(state)); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(temp, file);
  const dir = fs.openSync(path.dirname(file), 'r');
  try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
}

function empty() {
  return {version: POC_LIVE_POLICY.version, setups: {}, used: [], executions: {}, lastAt: null};
}

function validateState(state) {
  if (state?.version !== POC_LIVE_POLICY.version || !state.setups || !state.executions ||
      !Array.isArray(state.used) || Object.keys(state.setups).length > 300 || Object.keys(state.executions).length > 5000) {
    throw Error('POC_LIVE_JOURNAL_INVALID');
  }
  for (const [id, setup] of Object.entries(state.setups)) {
    if (id !== key(setup.side, setup.symbol) || !['LONG', 'SHORT'].includes(setup.side) ||
        !positive(setup.poc) || !positive(setup.structuralStop) || !Number.isFinite(setup.expiresAt) ||
        typeof setup.id !== 'string' || typeof setup.armed !== 'boolean') throw Error('POC_LIVE_JOURNAL_INVALID');
  }
  for (const [id, run] of Object.entries(state.executions)) {
    if (id !== run.id || typeof run.setupId !== 'string' || !['LONG', 'SHORT'].includes(run.side) ||
        !['EXECUTING', 'UNKNOWN', 'FILLED', 'NO_FILL', 'FAILED', 'CLOSED'].includes(run.status)) throw Error('POC_LIVE_JOURNAL_INVALID');
  }
}

// Strategy trigger and execution intent journal. Broker access is supplied by the live server.
// An unresolved exchange result is reconciled by its original ID; it is never submitted twice.
export class BinancePocLiveRunner {
  constructor({file, symbols, fetchMinutes, quote, execute, reconcile, manage, control,
    now = Date.now, save = saveAtomic, state}) {
    Object.assign(this, {file, symbols, fetchMinutes, quote, execute, reconcile, manage, control, now, saveImpl: save});
    this.state = empty(); this.busy = false; this.scanBusy = false; this.cursor = {LONG: 0, SHORT: 0};
    this.scanBuckets = new Map(); this.checkedAt = null; this.error = null; this.diagnostics = {};
    try {
      if (state) this.state = structuredClone(state);
      else if (fs.existsSync(file)) this.state = JSON.parse(fs.readFileSync(file, 'utf8'));
      validateState(this.state);
      // Do not resume an armed threshold across an unobserved restart.
      for (const setup of Object.values(this.state.setups)) { setup.armed = false; setup.armedAt = null; }
    } catch { this.fatal = 'POC_LIVE_JOURNAL_UNREADABLE'; }
  }

  save() {
    if (this.fatal) throw Error(this.fatal);
    try { validateState(this.state); this.saveImpl(this.file, this.state); }
    catch (error) { this.fatal = 'POC_LIVE_JOURNAL_WRITE_FAILED'; throw Error(this.fatal); }
  }

  status() {
    return {
      version: POC_LIVE_POLICY.version, enabled: this.control().enabled === true,
      executionReady: this.control().allowEntries === true && !this.fatal,
      fatal: this.fatal || null, error: this.error || null, checkedAt: this.checkedAt,
      pendingSetups: Object.values(this.state.setups).map(x => ({...x})),
      executions: Object.values(this.state.executions).slice(-100).reverse(),
      usedCount: this.state.used.length, diagnostics: this.diagnostics
    };
  }

  async scanOne(side) {
    const list = [...new Set(this.symbols(side) || [])].filter(s => /^[A-Z0-9]{2,25}USDT$/.test(s));
    if (!list.length) return;
    const cursor = this.cursor[side]++ % list.length, symbol = list[cursor], id = key(side, symbol);
    const bucket = Math.floor(this.now() / 300000);
    if (this.scanBuckets.get(id) === bucket) return;
    this.scanBuckets.set(id, bucket);
    const activeSetup = this.state.setups[id];
    if (activeSetup?.status && active.has(activeSetup.status) && activeSetup.historyAt === bucket * 300000) return;
    try {
      const rows = await this.fetchMinutes(side, symbol);
      const setup = findPocLiveSetup(rows, symbol, side, this.now());
      const old = this.state.setups[id];
      if (setup && !this.state.used.includes(setup.id) && !Object.values(this.state.executions).some(x => x.setupId === setup.id)) {
        this.state.setups[id] = setup.id === old?.id ? {...setup, armed: old.armed, armedAt: old.armedAt, status: 'WAITING'} : {...setup, armed: false, armedAt: null, status: 'WAITING'};
      } else if (!setup || old?.id !== setup.id) delete this.state.setups[id];
      this.diagnostics[id] = {at: this.now(), reason: setup ? 'WAIT_POC_RECLAIM' : 'WAIT_CONFIRMED_STRUCTURE'};
      this.save();
    } catch (error) {
      if (activeSetup && activeSetup.historyAt !== bucket * 300000) { delete this.state.setups[id]; try { this.save(); } catch {} }
      this.diagnostics[id] = {at: this.now(), reason: error.message || 'POC_SCAN_FAILED'};
    }
  }

  async scan() {
    if (this.scanBusy || this.fatal) return;
    this.scanBusy = true;
    try { await this.scanOne('LONG'); await this.scanOne('SHORT'); }
    finally { this.scanBusy = false; }
  }

  async resolveExecutions() {
    for (const run of Object.values(this.state.executions)) {
      if (!['EXECUTING', 'UNKNOWN'].includes(run.status)) continue;
      try {
        const result = await this.reconcile(run);
        if (!result) { run.status = 'UNKNOWN'; continue; }
        run.status = result.uncertain ? 'UNKNOWN' : result.ok && Number(result.executedQty || result.order?.executedQty) > 0 ? 'FILLED' : result.ok ? 'NO_FILL' : 'FAILED';
        run.result = result; run.updatedAt = this.now();
        if (run.status !== 'UNKNOWN') this.state.used.push(run.setupId);
        this.save();
      } catch { run.status = 'UNKNOWN'; }
    }
  }

  async cycle() {
    if (this.busy || this.fatal) return;
    this.busy = true;
    try {
      this.error = null;
      await this.resolveExecutions();
      await this.scan();
      for (const [id, setup] of Object.entries(this.state.setups)) {
        if (this.fatal) break;
        if (!active.has(setup.status || 'WAITING')) continue;
        if (this.now() >= setup.expiresAt) { delete this.state.setups[id]; this.save(); continue; }
        let q;
        try { q = await this.quote(setup.side, setup.symbol); }
        catch (error) { this.diagnostics[id] = {at: this.now(), reason: error.message || 'WAIT_FRESH_POC_QUOTE'}; continue; }
        const transition = pocQuoteTransition(setup, setup, q, this.now());
        if (transition.action === 'EXPIRE' || transition.action === 'INVALIDATE') {
          this.state.used.push(setup.id); delete this.state.setups[id]; this.save(); continue;
        }
        if (transition.action === 'ARM' || transition.action === 'HOLD_ARMED') {
          setup.armed = true; setup.armedAt = transition.quote.at; this.save(); continue;
        }
        if (transition.action === 'DISARM') { setup.armed = false; setup.armedAt = null; this.save(); continue; }
        if (transition.action !== 'ENTER') continue;
        if (this.control().allowEntries !== true) { this.diagnostics[id] = {at: this.now(), reason: 'POC_ENTRIES_PAUSED'}; continue; }
        const runId = `poc-${setup.id}`;
        if (this.state.executions[runId]) { delete this.state.setups[id]; this.save(); continue; }
        const run = this.state.executions[runId] = {
          id: runId, setupId: setup.id, side: setup.side, symbol: setup.symbol,
          poc: setup.poc, structuralStop: setup.structuralStop, status: 'EXECUTING',
          intentAt: this.now(), quoteAt: transition.quote.at
        };
        setup.status = 'EXECUTING'; this.save();
        try {
          const result = await this.execute(run, setup, async () => {
            if (this.control().allowEntries !== true || this.now() >= setup.expiresAt) throw Error('POC_FINAL_ENTRY_BLOCK');
            const latest = await this.quote(setup.side, setup.symbol);
            const check = pocQuoteTransition(setup, setup, latest, this.now());
            if (check.action !== 'ENTER') throw Error('POC_PRICE_NO_LONGER_READY');
            return check;
          });
          if (result?.deferred) { delete this.state.executions[runId]; setup.status = 'WAITING'; setup.armed = false; setup.armedAt = null; this.save(); continue; }
          run.status = result?.uncertain ? 'UNKNOWN' : result?.ok && Number(result.executedQty || result.order?.executedQty) > 0 ? 'FILLED' : result?.ok ? 'NO_FILL' : 'FAILED';
          run.result = result || null; run.updatedAt = this.now();
          if (run.status !== 'UNKNOWN') this.state.used.push(setup.id);
          delete this.state.setups[id]; this.save();
        } catch (error) {
          run.status = 'UNKNOWN'; run.error = error.message || 'POC_EXECUTION_UNKNOWN'; run.updatedAt = this.now();
          delete this.state.setups[id]; this.save();
        }
      }
      for (const side of sides) {
        const rows = Object.values(this.state.executions).filter(x => x.side === side && x.status === 'FILLED');
        for (const run of rows) {
          try { if (await this.manage(run, await this.quote(side, run.symbol)) === 'CLOSED') { run.status = 'CLOSED'; run.updatedAt = this.now(); this.save(); } }
          catch (error) { this.diagnostics[key(side, run.symbol)] = {at: this.now(), reason: error.message || 'POC_POSITION_MANAGEMENT_FAILED'}; }
        }
      }
      this.state.used = this.state.used.slice(-10000);
      if (Object.keys(this.state.executions).length > 4500) {
        for (const [id, run] of Object.entries(this.state.executions)) {
          if (['CLOSED', 'NO_FILL', 'FAILED'].includes(run.status)) delete this.state.executions[id];
          if (Object.keys(this.state.executions).length <= 4000) break;
        }
      }
      this.state.lastAt = this.now();
    } catch (error) { this.error = error.message || 'POC_LIVE_CYCLE_FAILED'; }
    finally { this.checkedAt = this.now(); this.busy = false; }
  }
}
