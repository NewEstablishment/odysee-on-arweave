import React, { useLayoutEffect, useRef, useState } from 'react';
import classnames from 'classnames';
import { useOnResize } from 'effects/use-on-resize';
import {
  TAB_CLASS,
  TAB_DIVIDER_CLASS,
  TAB_LIST_CLASS,
  TAB_PANEL_CLASS,
  TAB_SELECTED_CLASS,
  TABS_CLASS,
} from './tabs-classes';

type TabsContextValue = {
  selectedIndex: number;
  onSelectTab: (index: number) => void;
};

const TabsContext = React.createContext<TabsContextValue>({
  selectedIndex: 0,
  onSelectTab: () => {},
});

type TabsProps = {
  index?: number;
  onChange?: (arg0: number) => void;
  children: React.ReactNode;
  className?: string;
};

function Tabs(props: TabsProps) {
  const [selectedRect, setSelectedRect] = useState(null);
  const [tabsRect, setTabsRect] = React.useState<DOMRect | null>(null);
  const [internalIndex, setInternalIndex] = React.useState(0);
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const { children, className, index, onChange } = props;
  const selectedIndex = index === undefined ? internalIndex : index;

  const handleSelectTab = React.useCallback(
    (nextIndex: number) => {
      if (index === undefined) {
        setInternalIndex(nextIndex);
      }

      onChange?.(nextIndex);
    },
    [index, onChange]
  );

  const measureTabs = React.useCallback(() => {
    if (!tabsRef.current) {
      return;
    }

    const list = tabsRef.current.querySelector('[data-reach-tab-list]');
    const selectedTab = tabsRef.current.querySelector(`[data-tab-index="${selectedIndex}"]`);

    if (list instanceof HTMLElement) {
      setTabsRect(list.getBoundingClientRect());
    }

    if (selectedTab instanceof HTMLElement) {
      setSelectedRect(selectedTab.getBoundingClientRect());
    }
  }, [selectedIndex]);

  useOnResize(measureTabs);
  useLayoutEffect(() => {
    measureTabs();
  }, [measureTabs, selectedIndex, children]);

  const contextValue = React.useMemo(
    () => ({ selectedIndex, onSelectTab: handleSelectTab }),
    [selectedIndex, handleSelectTab]
  );

  // Render tab divider between tab list and panels (not after all content)
  const prePanel: React.ReactNode[] = [];
  const postPanel: React.ReactNode[] = [];
  let foundPanels = false;
  React.Children.forEach(children, (child) => {
    if (React.isValidElement(child) && child.type === TabPanels) {
      foundPanels = true;
    }
    (foundPanels ? postPanel : prePanel).push(child);
  });

  return (
    <TabsContext.Provider value={contextValue}>
      <div className={classnames(TABS_CLASS, className)} data-reach-tabs="" ref={tabsRef}>
        {prePanel}

        <div
          className={TAB_DIVIDER_CLASS}
          style={{
            left: selectedRect && tabsRect ? selectedRect.left - tabsRect.left : undefined,
            width: selectedRect ? selectedRect.width : undefined,
          }}
        />

        {postPanel}
      </div>
    </TabsContext.Provider>
  );
}

type TabListProps = {
  children?: React.ReactNode;
  className?: string;
};

function TabList(props: TabListProps) {
  const { children, className } = props;
  const { selectedIndex, onSelectTab } = React.useContext(TabsContext);
  let tabIndex = 0;
  const tabs = React.Children.map(children, (child) => {
    if (!React.isValidElement(child)) {
      return child;
    }

    const currentIndex = tabIndex++;
    return React.cloneElement(child, {
      index: currentIndex,
      isSelected: selectedIndex === currentIndex,
      onSelectTab,
    });
  });

  return (
    <div className={classnames(TAB_LIST_CLASS, className)} data-reach-tab-list="" role="tablist">
      {tabs}
    </div>
  );
}

type TabProps = {
  children?: React.ReactNode;
  index?: number;
  isSelected?: boolean;
  className?: string;
  onSelectTab?: (index: number) => void;
  [key: string]: any;
};

function Tab(props: TabProps) {
  const { children, className, index = 0, isSelected, onSelectTab, ...rest } = props;
  return (
    <button
      {...rest}
      type="button"
      role="tab"
      aria-selected={Boolean(isSelected)}
      data-reach-tab=""
      data-tab-index={index}
      className={classnames(
        TAB_CLASS,
        {
          [TAB_SELECTED_CLASS]: isSelected,
        },
        className
      )}
      onClick={() => onSelectTab?.(index)}
    >
      {children}
    </button>
  );
}

type TabPanelsProps = {
  children?: React.ReactNode;
  header?: React.ReactNode;
  panelClassName?: string;
};

function TabPanels(props: TabPanelsProps) {
  const { children, header, panelClassName } = props;
  const { selectedIndex } = React.useContext(TabsContext);
  const panels = React.Children.map(children, (child, index) => {
    if (!React.isValidElement<{ className?: string; isSelected?: boolean }>(child)) {
      return child;
    }

    return React.cloneElement(child, {
      className: classnames(child.props.className, panelClassName),
      isSelected: selectedIndex === index,
    });
  });

  return (
    <>
      {header}
      {panels}
    </>
  );
}

type TabPanelProps = {
  children?: React.ReactNode;
  isSelected?: boolean;
  className?: string;
};

function TabPanel(props: TabPanelProps) {
  const { children, className, isSelected } = props;

  return (
    <div
      data-reach-tab-panel=""
      role="tabpanel"
      className={classnames(TAB_PANEL_CLASS, className)}
      hidden={!isSelected}
    >
      {isSelected ? children : null}
    </div>
  );
}

export { Tabs, TabList, Tab, TabPanels, TabPanel };
