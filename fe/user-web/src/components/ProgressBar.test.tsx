import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProgressBar } from "./ProgressBar";

describe("ProgressBar", () => {
  it("renders all four step labels", () => {
    render(<ProgressBar status={null} />);

    expect(screen.getByText("File Uploaded")).toBeInTheDocument();
    expect(screen.getByText("Extracting Artifacts")).toBeInTheDocument();
    expect(screen.getByText("AI Grading")).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
  });

  it("marks the active step bold when status is Extracting", () => {
    render(<ProgressBar status="Extracting" />);

    const label = screen.getByText("Extracting Artifacts");
    expect(label).toHaveStyle({ fontWeight: "600" });

    const uploadedLabel = screen.getByText("File Uploaded");
    expect(uploadedLabel).toHaveStyle({ color: "#16a34a" });
  });

  it("marks every step completed when status is Completed", () => {
    render(<ProgressBar status="Completed" />);

    for (const label of ["File Uploaded", "Extracting Artifacts", "AI Grading", "Completed"]) {
      expect(screen.getByText(label)).toHaveStyle({ color: "#16a34a" });
    }
  });

  it("marks the Extracting step failed when status is ExtractionFailed", () => {
    render(<ProgressBar status="ExtractionFailed" />);

    const label = screen.getByText("Extracting Artifacts");
    expect(label).toHaveStyle({ color: "#dc2626", fontWeight: "600" });

    expect(screen.getByText("File Uploaded")).toHaveStyle({ color: "#16a34a" });
  });

  it("marks the AI Grading step failed when status is AiGradingFailed", () => {
    render(<ProgressBar status="AiGradingFailed" />);

    const label = screen.getByText("AI Grading");
    expect(label).toHaveStyle({ color: "#dc2626", fontWeight: "600" });

    expect(screen.getByText("File Uploaded")).toHaveStyle({ color: "#16a34a" });
    expect(screen.getByText("Extracting Artifacts")).toHaveStyle({ color: "#16a34a" });
  });

  it("keeps everything pending when status is null", () => {
    render(<ProgressBar status={null} />);

    for (const label of ["File Uploaded", "Extracting Artifacts", "AI Grading", "Completed"]) {
      expect(screen.getByText(label)).toHaveStyle({ color: "#64748b" });
    }
  });
});
