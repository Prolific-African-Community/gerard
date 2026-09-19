-- Add an explicit physical-presence status for trailers. Existing rows are
-- intentionally left unchanged: AVAILABLE remains an operational status only.
ALTER TYPE "TrailerStatus" ADD VALUE 'AT_BASE';
