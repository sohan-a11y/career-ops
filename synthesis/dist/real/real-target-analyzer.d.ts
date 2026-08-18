/**
 * Real ITargetAnalyzer — extracts a TargetMatrix from a real JD via the
 * headless AI bridge (see headless-ai-bridge.ts). Reads the JD through the
 * SAME lens modes/oferta.md's Block A/B already use — no separate,
 * competing extraction logic.
 */
import type { ITargetAnalyzer } from '../interfaces/target-analyzer.js';
import type { TargetMatrix } from '../types/target-matrix.js';
import { type HeadlessAiBridgeOptions } from './headless-ai-bridge.js';
export interface RealTargetAnalyzerOptions extends HeadlessAiBridgeOptions {
}
export declare class RealTargetAnalyzer implements ITargetAnalyzer {
    private readonly opts;
    constructor(opts: RealTargetAnalyzerOptions);
    analyze(source: string): Promise<TargetMatrix>;
}
//# sourceMappingURL=real-target-analyzer.d.ts.map