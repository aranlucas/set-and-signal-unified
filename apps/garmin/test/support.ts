/** Fails the current test when a value the scenario depends on is missing. */
export function required<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) {
    throw new Error(`Missing ${label}`);
  }

  return value;
}

export function requestUrl(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : input.toString();
}

import {
  Encoder,
  type FileIdMesg,
  type SessionMesg,
  type LapMesg,
  type RecordMesg,
  type EventMesg,
  type DeviceInfoMesg,
  type DeveloperDataIdMesg,
  type FieldDescriptionMesg,
} from "@garmin/fitsdk";

/** Synthetic multisport data, including a developer field that exceeds safe integer precision. */
export function recordedFitFixture(sampleCount = 1) {
  const encoder = new Encoder();
  const file: FileIdMesg = { type: "activity", manufacturer: "development", product: 1 };
  const developer: DeveloperDataIdMesg = { developerDataIndex: 0, applicationId: [1, 2, 3, 4] };

  const description: FieldDescriptionMesg = {
    developerDataIndex: 0,
    fieldDefinitionNumber: 0,
    fitBaseTypeId: 143,
    fieldName: "exactCounter",
    units: "count",
  };

  const session: SessionMesg = {
    sport: "running",
    startTime: 1_000_000_000,
    totalDistance: 1234.5,
    totalTimerTime: 600,
  };

  const lap: LapMesg = { startTime: 1_000_000_000, totalDistance: 1000, totalTimerTime: 300 };
  const event: EventMesg = { timestamp: 1_000_000_001, event: "timer", eventType: "start" };
  const device: DeviceInfoMesg = { serialNumber: 123456, productName: "Synthetic GPS device 🏃" };
  encoder.onMesg(0, file);
  encoder.onMesg(207, developer);
  encoder.onMesg(206, description);
  encoder.addDeveloperField(0, developer, description);
  encoder.onMesg(18, session);
  encoder.onMesg(19, lap);
  encoder.onMesg(21, event);
  encoder.onMesg(23, device);

  for (let i = 0; i < sampleCount; i += 1) {
    const record: RecordMesg = {
      timestamp: 1_000_000_000 + i,
      positionLat: 123456789,
      positionLong: -987654321,
      heartRate: 140,
      cadence: 82,
      power: 250,
      speed: 3.125,
      distance: i * 3.125,
      altitude: 123.4,
      temperature: 21,
      developerFields: { "0": 9007199254740993n },
    };

    encoder.onMesg(20, record);
  }

  return new Uint8Array(encoder.close());
}
