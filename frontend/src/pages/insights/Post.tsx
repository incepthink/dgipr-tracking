import { Navigate, useLocation } from "react-router-dom";

/** The single-post page only ever showed sample posts; real posts open on their platform from Analytics → Posts. */
export default function InsightsPost() {
  const { search } = useLocation();
  return <Navigate to={`/insights/posts${search}`} replace />;
}
