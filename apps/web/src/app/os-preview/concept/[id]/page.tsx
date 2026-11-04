import { ProjectWorkspaceView } from "../_components/project-workspace";

export const metadata = { title: "Project: ENGINIOUS OS design concept" };

export default async function ConceptProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProjectWorkspaceView id={id} />;
}
