// the component engine: one place that sets components up and reports their states, whatever they come from. a driver per
// source does the work -- npm packages, copies of Ollama models -- and the engine queues it, one job at a time per driver, so a
// download of hundreds of megabytes never holds up a model copy that takes seconds

import type { ComponentState } from '@shared/components';
import { InstallError } from './npm';

export interface Driver {
  // a name for the logs and for an unexpected failure
  readonly kind: string;
  owns(id: string): boolean;
  // the component's state while nothing is being done to it
  state(id: string): ComponentState;
  // sets the component up; a failure the user should read is an InstallError
  install(id: string, report: (step: string, bytes: number) => void): Promise<void>;
  // takes the component away; a driver without it has nothing the user removes
  remove?(id: string): Promise<void>;
}

export class ComponentEngine {
  private readonly working = new Map<string, ComponentState>();
  private readonly running = new Map<string, Promise<void>>();
  private readonly queues = new Map<Driver, Promise<unknown>>();

  constructor(
    private readonly drivers: Driver[],
    private readonly onChange: (id: string, state: ComponentState) => void = () => {},
  ) {}

  known(id: string): boolean {
    return this.drivers.some((d) => d.owns(id));
  }

  state(id: string): ComponentState {
    return this.working.get(id) ?? this.driver(id).state(id);
  }

  // a second call while one runs waits for the same job
  install(id: string): Promise<void> {
    const driver = this.driver(id);
    const running = this.running.get(id);
    if (running) return running;
    this.set(id, { status: 'installing', step: 'Waiting', bytes: 0 });
    const job = (this.queues.get(driver) ?? Promise.resolve()).then(() => this.run(driver, id));
    this.queues.set(driver, job.catch(() => {}));
    const tracked = job.finally(() => this.running.delete(id));
    this.running.set(id, tracked);
    return tracked;
  }

  // a component being set up is not removed under its own install
  async remove(id: string): Promise<void> {
    const driver = this.driver(id);
    if (!driver.remove) throw new Error(`${id} cannot be removed`);
    if (this.running.has(id)) throw new Error(`${id} is being set up`);
    await driver.remove(id);
    this.working.delete(id);
    this.onChange(id, this.state(id));
  }

  private async run(driver: Driver, id: string): Promise<void> {
    try {
      await driver.install(id, (step, bytes) => this.set(id, { status: 'installing', step, bytes }));
      this.working.delete(id);
      this.onChange(id, this.state(id));
    } catch (cause) {
      const error = cause instanceof InstallError ? cause : new InstallError(`${id} could not be set up.`, String((cause as Error).stack ?? cause));
      this.set(id, { status: 'failed', error: error.message, detail: error.detail });
      throw error;
    }
  }

  private set(id: string, state: ComponentState): void {
    this.working.set(id, state);
    this.onChange(id, state);
  }

  private driver(id: string): Driver {
    const driver = this.drivers.find((d) => d.owns(id));
    if (!driver) throw new Error(`no component called ${id}`);
    return driver;
  }
}
