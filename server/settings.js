import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { config } from './config.js';

export class SettingsStore {
  constructor(file = path.join(config.dataDir, 'settings.json')) {
    this.file = file;
    this.data = { customStacks: [] };
    try {
      this.data = { ...this.data, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    } catch (err) {
      if (err.code !== 'ENOENT') throw new Error(`Cannot read DevDeck settings: ${err.message}`);
    }
  }

  save(data) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(`${this.file}.tmp`, this.file);
    this.data = data;
  }

  saveAws(profile, region) {
    if (typeof profile !== 'string' || !/^[\w.@+=,-]{1,128}$/.test(profile.trim())) {
      throw new Error('Enter a valid AWS profile name (letters, numbers, _, ., @, +, =, comma or hyphen).');
    }
    if (typeof region !== 'string' || !/^[a-z]{2}(?:-[a-z]+)+-\d+$/.test(region.trim())) {
      throw new Error('Enter a valid AWS region, such as ap-south-1.');
    }
    const aws = { profile: profile.trim(), region: region.trim() };
    this.save({ ...this.data, aws });
    return aws;
  }

  saveStack({ id, name, services }, availableNames) {
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 80) {
      throw new Error('Stack name must contain 1–80 characters.');
    }
    if (!Array.isArray(services) || !services.length || services.length > 100 ||
        services.some((service) => typeof service !== 'string' || !availableNames.includes(service))) {
      throw new Error('Select between 1 and 100 repositories from the workspace.');
    }
    if (new Set(services).size !== services.length) throw new Error('Each repository can appear only once.');
    if (id && !this.data.customStacks.some((stack) => stack.id === id)) throw new Error('Stack not found.');
    if (this.data.customStacks.some((stack) => stack.id !== id && stack.name.toLowerCase() === name.trim().toLowerCase())) {
      throw new Error('A custom stack with that name already exists.');
    }
    const stack = { id: id || randomUUID(), name: name.trim(), services: [...services] };
    const customStacks = id
      ? this.data.customStacks.map((item) => item.id === id ? stack : item)
      : [...this.data.customStacks, stack];
    this.save({ ...this.data, customStacks });
    return stack;
  }

  deleteStack(id) {
    if (!this.data.customStacks.some((stack) => stack.id === id)) throw new Error('Stack not found.');
    this.save({ ...this.data, customStacks: this.data.customStacks.filter((stack) => stack.id !== id) });
  }
}

export const settings = new SettingsStore();
if (settings.data.aws) {
  config.awsProfile = settings.data.aws.profile;
  config.awsRegion = settings.data.aws.region;
}
