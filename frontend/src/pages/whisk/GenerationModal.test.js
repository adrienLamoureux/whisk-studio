import React from "react";
import { render, fireEvent, screen } from "@testing-library/react";
import GenerationModal from "./GenerationModal";

jest.mock("../../components/shared/CharacterLoraSelector", () => () => null);
jest.mock("./CivitaiLoraPanel", () => () => null);
jest.mock("./PromptHelperPanel", () => () => null);

function makeProps(overrides = {}) {
  return {
    apiBaseUrl: "https://api.example.com",
    onClose: jest.fn(),
    imageSource: "replicate",
    imageSourceOptions: [],
    setImageSource: jest.fn(),
    imageModel: "sdxl",
    imageModelOptions: [],
    onSelectModel: jest.fn(),
    imagePrompt: "",
    onImagePromptChange: jest.fn(),
    imageNegativePrompt: "",
    onImageNegativePromptChange: jest.fn(),
    imageSize: "1024x1024",
    imageSizeOptions: [],
    onImageSizeChange: jest.fn(),
    imageCount: 1,
    imageCountOptions: [],
    onImageCountChange: jest.fn(),
    imageScheduler: "",
    imageSchedulerOptions: [],
    onImageSchedulerChange: jest.fn(),
    imageGenerationName: "",
    onImageNameChange: jest.fn(),
    imageGenerationNotice: "",
    selectedCharacterId: "",
    setSelectedCharacterId: jest.fn(),
    selectedLoraProfileId: "",
    setSelectedLoraProfileId: jest.fn(),
    loraProfiles: [],
    imageGenerationProps: {},
    promptHelperCollapsed: true,
    setPromptHelperCollapsed: jest.fn(),
    imageUploadProps: {},
    isUploading: false,
    error: "",
    isGenerating: false,
    onGenerate: jest.fn(),
    ...overrides,
  };
}

describe("GenerationModal", () => {
  it("closes on Escape", () => {
    const props = makeProps();
    render(<GenerationModal {...props} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("moves initial focus to the close button", () => {
    render(<GenerationModal {...makeProps()} />);
    expect(screen.getByLabelText("Close")).toHaveFocus();
  });

  it("does not close on other keys", () => {
    const props = makeProps();
    render(<GenerationModal {...props} />);
    fireEvent.keyDown(window, { key: "Enter" });
    expect(props.onClose).not.toHaveBeenCalled();
  });
});
