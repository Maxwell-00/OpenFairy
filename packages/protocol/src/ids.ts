import { monotonicFactory } from "ulid";

const eventUlid = monotonicFactory();
const sessionUlid = monotonicFactory();

export const createEventId = (time?: number): `evt_${string}` => `evt_${eventUlid(time)}`;

export const createSessionId = (time?: number): `ses_${string}` => `ses_${sessionUlid(time)}`;
