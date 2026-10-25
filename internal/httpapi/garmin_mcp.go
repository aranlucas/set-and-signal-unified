package httpapi

import (
	"context"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"errors"
	"github.com/aranlucas/set-and-signal-unified/internal/garmin"
	"github.com/aranlucas/set-and-signal-unified/internal/training"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// The product MCP uses the same owner's built-in Garmin connection as web and
// Android. Existing users can keep the old connector while migrating clients.
func (s *Server) registerGarminMCP(server *mcp.Server) {
	read := mcpReadAnnotations()
	read.OpenWorldHint = new(true)
	server.AddTool(&mcp.Tool{Name: "get_garmin_day", Description: "Read the authenticated account's received Garmin Health and Activity data for YYYY-MM-DD. Availability and pagination remain explicit; missing data is not zero. Connect Garmin in Set & Signal settings first.", InputSchema: map[string]any{"type": "object", "properties": map[string]any{"date": map[string]any{"type": "string", "format": "date"}}, "required": []string{"date"}, "additionalProperties": false}, OutputSchema: map[string]any{"type": "object", "properties": map[string]any{"data": map[string]any{"type": "object"}}, "required": []string{"data"}}, Annotations: &read}, func(ctx context.Context, request *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		var input struct {
			Date string `json:"date"`
		}
		if err := json.Unmarshal(request.Params.Arguments, &input); err != nil || !training.ValidISODate(input.Date) {
			return nil, errors.New("date must be YYYY-MM-DD")
		}
		return s.garminMCPRead(ctx, "get_garmin_day", struct {
			Date  string `json:"date"`
			Limit int    `json:"limitPerType"`
		}{input.Date, 100})
	})
	server.AddTool(&mcp.Tool{Name: "get_garmin_activity", Description: "Read a received Garmin activity and its actual recorded FIT strength sets. Use an activityId returned by get_garmin_day. Does not turn planned targets into performed sets.", InputSchema: map[string]any{"type": "object", "properties": map[string]any{"activityId": map[string]any{"type": "string", "pattern": "^[1-9][0-9]{0,19}$"}}, "required": []string{"activityId"}, "additionalProperties": false}, OutputSchema: map[string]any{"type": "object", "properties": map[string]any{"data": map[string]any{"type": "object"}}, "required": []string{"data"}}, Annotations: &read}, func(ctx context.Context, request *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		var input struct {
			ID string `json:"activityId"`
		}
		if err := json.Unmarshal(request.Params.Arguments, &input); err != nil || !garminActivityID.MatchString(input.ID) {
			return nil, errors.New("activityId is required")
		}
		return s.garminMCPRead(ctx, "get_garmin_activity", input)
	})
	write := mcpWriteAnnotations(false, true)
	write.OpenWorldHint = new(true)
	server.AddTool(&mcp.Tool{Name: "publish_garmin_workout", Description: "After the user approves workout details and calendar date, publish and schedule a Garmin Training API workout. Supply a stable operation id and reuse it on retries. A needs_review result must not be repeated with a new id. Scheduled does not confirm watch delivery.", InputSchema: map[string]any{"type": "object", "properties": map[string]any{"id": map[string]any{"type": "string", "minLength": 8, "maxLength": 100}, "date": map[string]any{"type": "string", "format": "date"}, "workout": map[string]any{"type": "object", "description": "Garmin Training API V2 structured workout, including workoutName, sport, and segments."}}, "required": []string{"id", "date", "workout"}, "additionalProperties": false}, OutputSchema: map[string]any{"type": "object", "properties": map[string]any{"publication": map[string]any{"type": "object"}}, "required": []string{"publication"}}, Annotations: &write}, func(ctx context.Context, request *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		if s.Garmin == nil {
			return nil, errors.New("Garmin is not configured")
		}
		var input garmin.PublishRequest
		if err := json.Unmarshal(request.Params.Arguments, &input); err != nil {
			return nil, errors.New("invalid publication")
		}
		result, err := s.Garmin.Publish(ctx, mcpUID(ctx), input)
		if err != nil {
			return nil, err
		}
		raw, err := json.Marshal(result)
		if err != nil {
			return nil, err
		}
		return &mcp.CallToolResult{StructuredContent: map[string]jsontext.Value{"publication": raw}}, nil
	})
}

func (s *Server) garminMCPRead(ctx context.Context, name string, args any) (*mcp.CallToolResult, error) {
	if s.Garmin == nil {
		return nil, errors.New("Garmin is not configured")
	}
	data, err := s.Garmin.Call(ctx, mcpUID(ctx), name, args)
	if err != nil {
		return nil, err
	}
	return &mcp.CallToolResult{StructuredContent: map[string]jsontext.Value{"data": data}}, nil
}
