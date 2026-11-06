package httpapi

import "github.com/aranlucas/set-and-signal-unified/internal/training"

func (s *Server) loadTrainingData(uid string) (training.TrainingData, error) {
	return training.NewTrainingDataRepository(s.ST).Load(uid)
}
