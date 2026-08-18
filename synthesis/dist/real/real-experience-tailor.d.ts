/**
 * Real IExperienceTailor — resolves tailored titles and reworded highlights
 * per companyId via the headless AI bridge, using ONLY the candidate's real,
 * as-written cv.md bullets as source material (see
 * load-immutable-profile.ts's extractRawBulletsByCompanyId).
 *
 * One AI call covers every companyId in a single request rather than one
 * call per role — the interface already batches all companyIds together,
 * and there's no reason to pay N subprocess-spawn/model-inference costs
 * when one structured request can return the whole map.
 */
import type { IExperienceTailor } from '../interfaces/experience-tailor.js';
import type { TargetMatrix } from '../types/target-matrix.js';
import type { MutableEmploymentData } from '../types/mutable-payload.js';
import { type HeadlessAiBridgeOptions } from './headless-ai-bridge.js';
export interface RealExperienceTailorOptions extends HeadlessAiBridgeOptions {
}
export declare class RealExperienceTailor implements IExperienceTailor {
    private readonly opts;
    constructor(opts: RealExperienceTailorOptions);
    tailor(matrix: TargetMatrix, companyIds: readonly string[]): Promise<ReadonlyMap<string, MutableEmploymentData>>;
}
//# sourceMappingURL=real-experience-tailor.d.ts.map