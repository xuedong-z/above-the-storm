// Runs the sample-by-sample synthesis (score + thunder) off the main thread.
import { renderScore } from './score.js';
onmessage = e => { const [L, R] = renderScore(e.data.SR); postMessage({ L, R }, [L.buffer, R.buffer]); };
