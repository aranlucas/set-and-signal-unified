import { McpServer } from "@modelcontextprotocol/server";
import type { ZodType } from "zod";
import { TrainingClient, TrainingError } from "./client";
import {
  createWorkoutInput,
  updateWorkoutInput,
  updateScheduleInput,
  workoutWriteResponse,
  scheduleWriteResponse,
  mutationAccepted,
  getWorkoutInput,
  scheduleWorkoutInput,
  getScheduleInput,
  listSchedulesInput,
  workoutResponse,
  scheduleResponse,
  schedulesResponse,
  type TrainingData,
} from "./schemas";

export const TRAINING_INSTRUCTIONS =
  "Garmin business Training API. Ask the user to approve the workout details and calendar date before writing. Create a workout, retain the returned workoutId, then schedule that ID for a Garmin calendar date. Garmin Connect syncs workouts to compatible devices; success here does not confirm watch delivery. Do not automatically repeat a write after an error: it may already have succeeded. PACE and SPEED targets use meters per second (not minutes per kilometer); TIME uses seconds, DISTANCE uses meters, weights use kilograms. Workouts use v2 segments with globally increasing stepOrder values. If a write returns accepted:true without an ID, inspect Garmin Connect before any retry; do not invent an ID or repeat creation. Dates are Garmin calendar dates, not UTC timestamps. Garmin credentials must never appear in results.";

type TrainingResult = { source: string; data: TrainingData; deviceSync?: string };

export function createTrainingServer(
  accessToken: string,
  fetcher: typeof fetch = fetch,
): McpServer {
  const server = new McpServer(
    { name: "garmin-training", version: "1.0.0" },
    {
      instructions: TRAINING_INSTRUCTIONS,
    },
  );

  registerTrainingTools(server, accessToken, fetcher);

  return server;
}

export function registerTrainingTools(
  server: McpServer,
  accessToken: string,
  fetcher: typeof fetch = fetch,
): void {
  const client = new TrainingClient(accessToken, fetcher);

  function register<Input extends object>(
    name: string,
    description: string,
    inputSchema: ZodType<Input>,
    write: boolean,
    run: (input: Input, signal: AbortSignal) => Promise<TrainingData>,
  ): void {
    server.registerTool(
      name,
      {
        description,
        inputSchema,
        annotations: {
          readOnlyHint: !write,
          destructiveHint: name.startsWith("delete_") || name.startsWith("update_"),
          idempotentHint: !write,
          openWorldHint: true,
        },
      },
      async (input, ctx) => {
        try {
          await client.requireWorkoutPermission(ctx.mcpReq.signal);
          const data = await run(input, ctx.mcpReq.signal);

          const result: TrainingResult = {
            source: "Garmin Connect",
            data,
          };

          if (write && !name.startsWith("delete_")) {
            result.deviceSync =
              "Sync Garmin Connect with your compatible device to download the workout. Watch delivery has not been confirmed.";
          }

          return {
            structuredContent: result,
            content: [{ type: "text", text: JSON.stringify(result) }],
          };
        } catch (error) {
          const message =
            error instanceof TrainingError
              ? error.message
              : "The Garmin Training request failed. Check Garmin Connect before retrying a write.";

          return { isError: true, content: [{ type: "text", text: message }] };
        }
      },
    );
  }

  register(
    "create_workout",
    "Publish a structured workout to the user's Garmin Connect account. Confirm the details first. Use schedule_workout with the returned workoutId to add it to the calendar for device sync. Do not blindly retry.",
    createWorkoutInput,
    true,
    ({ workout }, signal) => client.createWorkout(workoutWriteResponse, workout, signal),
  );
  register(
    "get_workout",
    "Retrieve a previously published Training API workout by ID. Source: Garmin Connect.",
    getWorkoutInput,
    false,
    ({ workoutId }, signal) => client.getWorkout(workoutResponse, workoutId, signal),
  );
  register(
    "schedule_workout",
    "Add an existing workout to the Garmin Connect calendar on YYYY-MM-DD for sync to compatible devices. Confirm the date first. Do not blindly retry.",
    scheduleWorkoutInput,
    true,
    (schedule, signal) => client.scheduleWorkout(scheduleWriteResponse, schedule, signal),
  );
  register(
    "get_workout_schedule",
    "Read a workout calendar entry by schedule ID. This does not confirm watch delivery. Source: Garmin Connect.",
    getScheduleInput,
    false,
    ({ scheduleId }, signal) => client.getSchedule(scheduleResponse, scheduleId, signal),
  );
  register(
    "list_workout_schedules",
    "Read scheduled workouts for an inclusive date range of at most 31 calendar days. Source: Garmin Connect.",
    listSchedulesInput,
    false,
    ({ startDate, endDate }, signal) =>
      client.listSchedules(schedulesResponse, startDate, endDate, signal),
  );

  register(
    "update_workout",
    "Replace a published workout with its full details. Confirm the changes first. Supply ownerId from get_workout. Do not blindly retry.",
    updateWorkoutInput,
    true,
    ({ workoutId, ownerId, workout }, signal) =>
      client.updateWorkout(workoutWriteResponse, workoutId, ownerId, workout, signal),
  );
  register(
    "delete_workout",
    "Delete a published workout. Confirm deletion first. This changes the user's Garmin Connect account.",
    getWorkoutInput,
    true,
    ({ workoutId }, signal) => client.deleteWorkout(mutationAccepted, workoutId, signal),
  );
  register(
    "update_workout_schedule",
    "Replace a workout calendar entry with a workout ID and date. Confirm the new workout and date first.",
    updateScheduleInput,
    true,
    ({ scheduleId, workoutId, date }, signal) =>
      client.updateSchedule(scheduleWriteResponse, scheduleId, { workoutId, date }, signal),
  );
  register(
    "delete_workout_schedule",
    "Remove a workout from the Garmin Connect calendar by schedule ID. Confirm removal first.",
    getScheduleInput,
    true,
    ({ scheduleId }, signal) => client.deleteSchedule(mutationAccepted, scheduleId, signal),
  );
}
