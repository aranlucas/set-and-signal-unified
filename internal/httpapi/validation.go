package httpapi

import (
	"net/http"

	"github.com/aranlucas/set-and-signal-unified/internal/validation"
)

func readValidatedJSON[T any](w http.ResponseWriter, r *http.Request, dst *T) bool {
	if !readJSON(w, r, dst) {
		return false
	}
	if err := validation.Validator.Struct(dst); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return false
	}
	return true
}
