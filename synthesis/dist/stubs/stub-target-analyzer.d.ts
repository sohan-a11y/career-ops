/**
 * Stub ITargetAnalyzer — parses the JD text into a TargetMatrix.
 * In production this would use an LLM or NLP pipeline.
 */
import type { ITargetAnalyzer } from '../interfaces/target-analyzer.js';
import type { TargetMatrix } from '../types/target-matrix.js';
export declare class StubTargetAnalyzer implements ITargetAnalyzer {
    analyze(source: string): Promise<TargetMatrix>;
}
//# sourceMappingURL=stub-target-analyzer.d.ts.map