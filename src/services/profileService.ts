import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { BrowserContext } from 'playwright-core';
import { env } from '../config/env.js';

export interface BrowserProfile {
  profileId: string;
  storageStatePath: string;
  exists: boolean;
}

function safeProfileId(profileId: string): string {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(profileId)) {
    throw new Error('profileId must contain only letters, numbers, underscore, or hyphen');
  }
  return profileId;
}

export class ProfileService {
  private root = path.resolve(env.BROWSER_PROFILE_ROOT);

  getProfile(profileId: string): BrowserProfile {
    const safe = safeProfileId(profileId);
    return {
      profileId: safe,
      storageStatePath: path.join(this.root, safe, 'storage-state.json'),
      exists: false,
    };
  }

  async ensure(profileId: string): Promise<BrowserProfile> {
    const profile = this.getProfile(profileId);
    await mkdir(path.dirname(profile.storageStatePath), { recursive: true });
    profile.exists = await this.exists(profileId);
    return profile;
  }

  async exists(profileId: string): Promise<boolean> {
    const profile = this.getProfile(profileId);
    return stat(profile.storageStatePath).then(() => true).catch(() => false);
  }

  async storageStateOption(profileId?: string): Promise<string | undefined> {
    if (!profileId) return undefined;
    const profile = await this.ensure(profileId);
    return profile.exists ? profile.storageStatePath : undefined;
  }

  async saveContext(profileId: string | undefined, context: BrowserContext): Promise<void> {
    if (!profileId) return;
    const profile = await this.ensure(profileId);
    await context.storageState({ path: profile.storageStatePath });
  }

  async exportStorageState(profileId: string): Promise<unknown | null> {
    const profile = this.getProfile(profileId);
    if (!(await this.exists(profileId))) return null;
    const data = await readFile(profile.storageStatePath, 'utf8');
    return JSON.parse(data) as unknown;
  }

  async delete(profileId: string): Promise<void> {
    const profile = this.getProfile(profileId);
    await rm(path.dirname(profile.storageStatePath), { recursive: true, force: true });
  }
}

export const profileService = new ProfileService();
