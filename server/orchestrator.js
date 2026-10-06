import { supervisor } from './supervisor.js';
import { discovery } from './discovery.js';

class Orchestrator {
  constructor() {
    this.activeStack = null; // 'v1' | 'v3' | null
    this.stackName = null;
    this.customRun = null;
    this.message = '';
    this.currentStep = 0;
    this.totalSteps = 0;
    this.status = 'IDLE'; // 'IDLE' | 'STARTING' | 'RUNNING' | 'ERROR'
    this.listeners = new Set();
  }

  onEvent(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emitProgress(data) {
    if (data.message) this.message = data.message;
    const payload = {
      activeStack: this.activeStack,
      stackName: this.stackName,
      status: this.status,
      currentStep: this.currentStep,
      totalSteps: this.totalSteps,
      message: this.message,
      ...data
    };
    for (const listener of this.listeners) {
      try {
        listener(payload);
      } catch (err) {
        console.error('[Orchestrator] Listener error:', err);
      }
    }
  }

  getStatus() {
    return {
      activeStack: this.activeStack,
      stackName: this.stackName,
      status: this.status,
      currentStep: this.currentStep,
      totalSteps: this.totalSteps,
      message: this.message
    };
  }

  async startV1Stack() {
    if (this.status === 'STARTING') {
      throw new Error('A stack startup sequence is already in progress.');
    }

    this.activeStack = 'v1';
    this.stackName = 'V1 Full Stack';
    this.status = 'STARTING';

    const steps = [
      { name: 'verteil-ui', waitPort: false, delayMs: 1000, desc: 'Frontend Web Portal' },
      { name: 'tomcat-vdc', waitPort: 2243, delayMs: 3000, desc: 'Apache Tomcat Container' },
      { name: 'vdc-configurator', waitPort: 8090, delayMs: 2000, desc: 'VDC Central Configurator' },
      { name: 'auth-service', waitPort: 9000, delayMs: 2000, desc: 'Authentication & SSO Service' },
      { name: 'agencymanagement-v1', waitPort: 8098, delayMs: 2000, desc: 'Agency Management V1' },
      { name: 'entrygate-service', waitPort: 8081, delayMs: 2000, desc: 'Entrygate API Gateway' },
      { name: 'ordermanagement-v1', waitPort: 9003, delayMs: 1500, desc: 'Order Management V1' },
      { name: 'offermanagement-v1', waitPort: 8097, delayMs: 1500, desc: 'Offer Management V1' },
      { name: 'payment', waitPort: 8051, delayMs: 1500, desc: 'Payment Service' },
      { name: 'opendata', waitPort: 9010, delayMs: 1000, desc: 'OpenData Service' }
    ];

    this.totalSteps = steps.length;
    this.currentStep = 0;

    console.log('[Orchestrator] Starting V1 Full Stack...');
    this.emitProgress({ message: 'Initializing V1 Stack startup...' });

    try {
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        this.currentStep = i + 1;

        const repo = discovery.get(step.name);
        if (!repo) {
          console.warn(`[Orchestrator] Repository ${step.name} not found in workspace, skipping.`);
          this.emitProgress({
            currentApp: step.name,
            message: `Repository ${step.name} not found in workspace, skipping...`
          });
          continue;
        }

        this.emitProgress({
          currentApp: step.name,
          message: `Starting ${step.name} (${step.desc})...`
        });

        try {
          // entrygate-service has a strict startup dependency on auth-service (fetches JWKS / OAuth metadata)
          if (step.name === 'entrygate-service') {
            this.emitProgress({
              currentApp: step.name,
              message: 'Ensuring auth-service is fully responsive before launching entrygate-service...'
            });
            const authReady = await supervisor.waitForHttp(
              'http://localhost:9000/.well-known/oauth-authorization-server',
              90000,
              1000
            );
            if (authReady) {
              console.log('[Orchestrator] auth-service is confirmed responsive and warmed up.');
            } else {
              console.warn('[Orchestrator] Warning: auth-service did not respond within timeout, starting entrygate-service anyway...');
            }
          }

          await supervisor.start(step.name);

          // If step specifies waiting for port, probe it
          if (step.waitPort) {
            const portToProbe = repo.port || step.waitPort;
            this.emitProgress({
              currentApp: step.name,
              message: `Waiting for ${step.name} to accept connections on port ${portToProbe}...`
            });
            const isReady = await supervisor.waitForPort(portToProbe, 90000, 1000);
            if (isReady) {
              console.log(`[Orchestrator] ${step.name} is ready on port ${portToProbe}.`);
            } else {
              console.warn(`[Orchestrator] ${step.name} port wait timed out, continuing...`);
            }
          }

          if (step.delayMs) {
            await new Promise((r) => setTimeout(r, step.delayMs));
          }
        } catch (err) {
          console.error(`[Orchestrator] Error starting ${step.name}:`, err.message);
          this.emitProgress({
            currentApp: step.name,
            message: `Warning: Failed to start ${step.name}: ${err.message}`
          });
          // Continue with next service if possible
        }
      }

      this.status = 'RUNNING';
      this.emitProgress({
        message: 'V1 Stack successfully started!',
        status: 'RUNNING'
      });
      return { success: true };
    } catch (err) {
      this.status = 'ERROR';
      this.emitProgress({
        message: `V1 Stack startup failed: ${err.message}`,
        status: 'ERROR'
      });
      throw err;
    }
  }

  async startV3Stack() {
    if (this.status === 'STARTING') {
      throw new Error('A stack startup sequence is already in progress.');
    }

    this.activeStack = 'v3';
    this.stackName = 'V3 NDC Stack';
    this.status = 'STARTING';

    const steps = [
      { name: 'ordermanagement', waitPort: 8091, delayMs: 1500, desc: 'Order Management V3' },
      { name: 'offermanagement', waitPort: 8093, delayMs: 1500, desc: 'Offer Management V3' }
    ];

    this.totalSteps = steps.length;
    this.currentStep = 0;

    console.log('[Orchestrator] Starting V3 Stack...');
    this.emitProgress({ message: 'Initializing V3 Stack startup...' });

    try {
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        this.currentStep = i + 1;

        const repo = discovery.get(step.name);
        if (!repo) {
          console.warn(`[Orchestrator] Repo ${step.name} not found, skipping.`);
          continue;
        }

        this.emitProgress({
          currentApp: step.name,
          message: `Starting ${step.name} (${step.desc})...`
        });

        try {
          await supervisor.start(step.name);

          if (step.waitPort) {
            const portToProbe = repo.port || step.waitPort;
            await supervisor.waitForPort(portToProbe, 35000, 1000);
          }

          if (step.delayMs) {
            await new Promise((r) => setTimeout(r, step.delayMs));
          }
        } catch (err) {
          console.error(`[Orchestrator] Error starting ${step.name}:`, err.message);
          this.emitProgress({
            currentApp: step.name,
            message: `Warning: Failed to start ${step.name}: ${err.message}`
          });
        }
      }

      this.status = 'RUNNING';
      this.emitProgress({
        message: 'V3 Stack successfully started!',
        status: 'RUNNING'
      });
      return { success: true };
    } catch (err) {
      this.status = 'ERROR';
      this.emitProgress({
        message: `V3 Stack startup failed: ${err.message}`,
        status: 'ERROR'
      });
      throw err;
    }
  }

  async startCustomStack(stack) {
    if (this.status === 'STARTING' || this.customRun) throw new Error('A stack startup sequence is already in progress.');
    const missing = stack.services.filter((name) => !discovery.get(name));
    if (missing.length) throw new Error(`Repositories no longer available: ${missing.join(', ')}`);
    const run = { cancelled: false };
    this.customRun = run;
    this.activeStack = stack.id;
    this.stackName = stack.name;
    this.status = 'STARTING';
    this.currentStep = 0;
    this.totalSteps = stack.services.length;
    this.emitProgress({ message: `Starting ${stack.name}...` });
    try {
      for (const name of stack.services) {
        if (run.cancelled) return;
        this.currentStep++;
        this.emitProgress({ currentApp: name, message: `Starting ${name}...` });
        const result = await supervisor.start(name);
        if (run.cancelled) {
          await supervisor.stop(name);
          return;
        }
        if (result?.success === false) throw new Error(result.message || `Failed to start ${name}`);
        const repo = discovery.get(name);
        if (repo.port) {
          const ready = await supervisor.waitForPort(repo.port, 90000, 1000);
          if (run.cancelled) return;
          if (!ready) throw new Error(`${name} did not become ready on port ${repo.port}.`);
        }
      }
      this.status = 'RUNNING';
      this.emitProgress({ message: `${stack.name} successfully started!` });
      return { success: true };
    } catch (err) {
      if (!run.cancelled) {
        this.status = 'ERROR';
        this.emitProgress({ message: `${stack.name} failed: ${err.message}` });
      }
      throw err;
    } finally {
      if (this.customRun === run) this.customRun = null;
    }
  }

  async stopAll() {
    if (this.customRun) this.customRun.cancelled = true;
    this.activeStack = null;
    this.stackName = null;
    this.status = 'IDLE';
    this.currentStep = 0;
    this.emitProgress({ message: 'Stopping all services...' });
    await supervisor.stopAll();
    this.emitProgress({ message: 'All services stopped.', status: 'IDLE' });
    return { success: true };
  }
}

export const orchestrator = new Orchestrator();
