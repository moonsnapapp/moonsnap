import { useCaptureStore } from './captureStore';

export function useAppCaptureStoreState() {
  const view = useCaptureStore((state) => state.view);
  const captures = useCaptureStore((state) => state.captures);
  const loadProject = useCaptureStore((state) => state.loadProject);
  const loadVideoProjectInWorkspace = useCaptureStore(
    (state) => state.loadVideoProjectInWorkspace
  );
  const loadGifInWorkspace = useCaptureStore((state) => state.loadGifInWorkspace);
  const clearCurrentProject = useCaptureStore((state) => state.clearCurrentProject);
  const saveNewCaptureFromFile = useCaptureStore((state) => state.saveNewCaptureFromFile);
  const loadCaptures = useCaptureStore((state) => state.loadCaptures);

  return {
    view,
    captures,
    loadProject,
    loadVideoProjectInWorkspace,
    loadGifInWorkspace,
    clearCurrentProject,
    saveNewCaptureFromFile,
    loadCaptures,
  };
}

export function useCaptureLibraryStoreState() {
  const loading = useCaptureStore((state) => state.loading);
  const initialized = useCaptureStore((state) => state.initialized);
  const loadingProjectId = useCaptureStore((state) => state.loadingProjectId);
  const loadCaptures = useCaptureStore((state) => state.loadCaptures);
  const deleteCapture = useCaptureStore((state) => state.deleteCapture);
  const deleteCaptures = useCaptureStore((state) => state.deleteCaptures);
  const currentProject = useCaptureStore((state) => state.currentProject);
  const view = useCaptureStore((state) => state.view);
  const setCurrentProject = useCaptureStore((state) => state.setCurrentProject);
  const setCurrentImageData = useCaptureStore((state) => state.setCurrentImageData);
  const setView = useCaptureStore((state) => state.setView);
  const toggleFavorite = useCaptureStore((state) => state.toggleFavorite);
  const updateTags = useCaptureStore((state) => state.updateTags);
  const searchQuery = useCaptureStore((state) => state.searchQuery);
  const setSearchQuery = useCaptureStore((state) => state.setSearchQuery);
  const filterFavorites = useCaptureStore((state) => state.filterFavorites);
  const setFilterFavorites = useCaptureStore((state) => state.setFilterFavorites);
  const filterTags = useCaptureStore((state) => state.filterTags);
  const setFilterTags = useCaptureStore((state) => state.setFilterTags);
  const filterMediaTypes = useCaptureStore((state) => state.filterMediaTypes);
  const setFilterMediaTypes = useCaptureStore((state) => state.setFilterMediaTypes);
  const libraryItemScale = useCaptureStore((state) => state.libraryItemScale);
  const setLibraryItemScale = useCaptureStore((state) => state.setLibraryItemScale);
  const folders = useCaptureStore((state) => state.folders);
  const activeFolderId = useCaptureStore((state) => state.activeFolderId);
  const setActiveFolder = useCaptureStore((state) => state.setActiveFolder);
  const loadFolders = useCaptureStore((state) => state.loadFolders);
  const moveCapturesToFolder = useCaptureStore((state) => state.moveCapturesToFolder);

  return {
    loading,
    initialized,
    loadingProjectId,
    loadCaptures,
    deleteCapture,
    deleteCaptures,
    currentProject,
    view,
    setCurrentProject,
    setCurrentImageData,
    setView,
    toggleFavorite,
    updateTags,
    searchQuery,
    setSearchQuery,
    filterFavorites,
    setFilterFavorites,
    filterTags,
    setFilterTags,
    filterMediaTypes,
    setFilterMediaTypes,
    libraryItemScale,
    setLibraryItemScale,
    folders,
    activeFolderId,
    setActiveFolder,
    loadFolders,
    moveCapturesToFolder,
  };
}
