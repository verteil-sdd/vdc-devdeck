// Isolated API fixture: no AWS calls, filesystem discovery or service processes.
import http from 'node:http';
import { config } from '../../server/config.js';
import { awsManager } from '../../server/awsManager.js';
import { discovery } from '../../server/discovery.js';
import { supervisor } from '../../server/supervisor.js';

config.port = 0;
config.host = '127.0.0.1';
awsManager.run = async (command, args, options) => {
  if (options.env.AWS_PROFILE === 'expired-profile') {
    throw Object.assign(new Error('SSO expired'), { stderr: 'SSO session expired' });
  }
  return { stdout: JSON.stringify(args.includes('export-credentials')
    ? { AccessKeyId: 'fake-key', SecretAccessKey: 'fake-secret', SessionToken: 'fake-session', Expiration: new Date(Date.now() + 3600000).toISOString() }
    : { authorizationToken: 'fake-codeartifact-token', expiration: new Date(Date.now() + 43200000).toISOString() }) };
};
discovery.init = async () => {
  discovery.repositories.set('auth', { name: 'auth', port: 9000 });
  discovery.repositories.set('gateway', { name: 'gateway', port: 8081 });
};
supervisor.start = async () => ({ success: true });
supervisor.waitForPort = async () => true;
const listen = http.Server.prototype.listen;
http.Server.prototype.listen = function (...args) {
  this.once('listening', () => process.send({ port: this.address().port }));
  return listen.apply(this, args);
};
await import('../../server/index.js');
