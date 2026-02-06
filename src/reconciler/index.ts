import Reconciler from 'react-reconciler';
import { hostConfig, Container } from './host-config';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const reconciler = Reconciler(hostConfig as any);

export type { Container };
