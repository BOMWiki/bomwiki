import { EventEmitter } from 'node:events';
import {
  DEFAULT_READ_PRESSURE_LIMIT,
  ENGINE_LISTEN_BACKLOG,
  MAX_READ_PRESSURE_LIMIT,
  ReadPressureGate,
  holdReadPressureSlot,
  isPressureRead,
  isReadMethod,
  parseReadPressureLimit,
} from '../src/read-pressure.ts';

let checks = 0;

function check(name: string, condition: boolean): void {
  checks++;
  if (!condition) throw new Error(`FAIL ${name}`);
  console.log(`ok   ${name}`);
}

for (const path of [
  '/item/airliner/rev/1',
  '/item/airliner/history',
  '/item/airliner/talk',
  '/item/airliner/model/upload',
]) {
  check(`GET admission covers ${path}`, isPressureRead('GET', path));
  check(`HEAD admission covers ${path}`, isPressureRead('HEAD', path));
}

for (const path of [
  '/',
  '/item/airliner/',
  '/item/airliner/revert/1',
  '/item/airliner/history/',
  '/api/session',
]) {
  check(`admission excludes ${path}`, !isPressureRead('GET', path));
}
check('admission excludes writes', !isPressureRead('POST', '/item/airliner/talk'));
check('admission accepts current node id characters', isPressureRead('GET', '/item/ABC_1.2-x/rev/42'));
check('GET is a read method', isReadMethod('GET'));
check('HEAD is a read method', isReadMethod('HEAD'));
check('POST is not a read method', !isReadMethod('POST'));
check('OPTIONS is not a read method', !isReadMethod('OPTIONS'));

check(
  'missing limit uses default',
  parseReadPressureLimit(undefined) === DEFAULT_READ_PRESSURE_LIMIT,
);
check('empty limit uses default', parseReadPressureLimit('') === DEFAULT_READ_PRESSURE_LIMIT);
check('invalid limit uses default', parseReadPressureLimit('many') === DEFAULT_READ_PRESSURE_LIMIT);
check('fractional limit uses default', parseReadPressureLimit('8.5') === DEFAULT_READ_PRESSURE_LIMIT);
check('limit trims whitespace', parseReadPressureLimit(' 12 ') === 12);
check('zero limit clamps to one', parseReadPressureLimit('0') === 1);
check('negative limit clamps to one', parseReadPressureLimit('-9') === 1);
check(
  'large limit clamps to maximum',
  parseReadPressureLimit('999') === MAX_READ_PRESSURE_LIMIT,
);
check('listen backlog matches host capacity', ENGINE_LISTEN_BACKLOG === 4096);

const gate = new ReadPressureGate(2);
const releaseFirst = gate.acquire();
const releaseSecond = gate.acquire();
check('gate admits up to its limit', Boolean(releaseFirst) && Boolean(releaseSecond));
check('gate reports admitted reads', gate.active === 2);
check('gate rejects the next read', gate.acquire() === null);

releaseFirst!();
check('release returns one slot', gate.active === 1);
releaseFirst!();
check('release is idempotent', gate.active === 1);

const releaseThird = gate.acquire();
check('released slot can be reused', Boolean(releaseThird) && gate.active === 2);
releaseSecond!();
releaseThird!();
check('all slots return after completion', gate.active === 0);

const lifecycleGate = new ReadPressureGate(1);
const lifecycle = new EventEmitter();
check('response lifecycle acquires a slot', holdReadPressureSlot(lifecycleGate, lifecycle));
check('response lifecycle holds the slot', lifecycleGate.active === 1);
check('response lifecycle rejects while full', !holdReadPressureSlot(lifecycleGate, new EventEmitter()));
lifecycle.emit('finish');
check('finish releases the response slot', lifecycleGate.active === 0);
lifecycle.emit('close');
check('close after finish does not release twice', lifecycleGate.active === 0);

const closeOnly = new EventEmitter();
check('close-only lifecycle acquires a slot', holdReadPressureSlot(lifecycleGate, closeOnly));
closeOnly.emit('close');
check('close releases an unfinished response', lifecycleGate.active === 0);

console.log(`read-pressure checks passed: ${checks}`);
