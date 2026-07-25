import { App as ObsidianApp } from 'obsidian';
import AppVersionManagerPlugin from '../main';
import { Project, Version, ProjectLink, ProjectProgress, getProgressOrder, getFirstProgress, Todo, Category, App } from '../types';

export interface ExportProjectJson {
  projectName: string;
  appVersions: string;
  manager: string;
  projectLink: string;
  componentLink: string;
  features: string;
  requirements: string;
  progress: string;
  b1IntegrationTestTime: string;
  b1SystemTestTime: string;
  b2IntegrationTestTime: string;
  b2SystemTestTime: string;
  b3IntegrationTestTime: string;
  b3SystemTestTime: string;
  b4IntegrationTestTime: string;
  b4SystemTestTime: string;
  actualReleaseTime: string;
  createdAt: string;
  updatedAt: string;
}

export class ImportExportService {
  app: ObsidianApp;
  plugin: AppVersionManagerPlugin;

  constructor(app: ObsidianApp, plugin: AppVersionManagerPlugin) {
    this.app = app;
    this.plugin = plugin;
  }

  async exportToCSV(projects: Project[], versions: Version[], apps: App[]): Promise<string> {
    const headers = [
      '项目名称',
      '关联APP/版本',
      '项目经理',
      '项目链接',
      '组件库链接',
      '特性',
      '项目需求',
      '项目进度',
      'B1集成测试时间',
      'B1系统测试时间',
      'B2集成测试时间',
      'B2系统测试时间',
      'B3集成测试时间',
      'B3系统测试时间',
      'B4集成测试时间',
      'B4系统测试时间',
      '实际发布时间',
      '创建时间',
      '更新时间',
    ];

    const appMap = new Map(apps.map((a) => [a.id, a]));
    const versionMap = new Map(versions.map((v) => [v.id, v]));

    const rows = projects.map((project) => {
      // 将 APP/版本对序列化为 "APP-A/v1.0; APP-B/v2.0" 格式
      const appVersionStr = project.appVersionLinks
        .map((link) => {
          const app = appMap.get(link.appId);
          const version = versionMap.get(link.versionId);
          const appName = app?.name || '(未知)';
          const verName = version?.versionNumber || '(未知)';
          return `${appName}/${verName}`;
        })
        .join('; ');

      return [
        project.name,
        appVersionStr,
        project.manager,
        project.projectLink,
        project.componentLink,
        project.features || '',
        (project.requirements || '').replace(/\n/g, '\\n'),
        project.progress,
        project.b1IntegrationTestTime,
        project.b1SystemTestTime,
        project.b2IntegrationTestTime,
        project.b2SystemTestTime,
        project.b3IntegrationTestTime,
        project.b3SystemTestTime,
        project.b4IntegrationTestTime,
        project.b4SystemTestTime,
        project.actualReleaseTime,
        project.createdAt,
        project.updatedAt,
      ];
    });

    const csvContent = [headers.join(','), ...rows.map((row) => row.map((cell) => this.escapeCSV(cell)).join(','))].join('\n');

    return csvContent;
  }

  private escapeCSV(value: string): string {
    const normalized = value ?? '';
    const formulaUnsafe = /^[=+\-@]/.test(normalized);
    const protectedValue = formulaUnsafe ? `'${normalized}` : normalized;
    if (protectedValue.includes(',') || protectedValue.includes('"') || protectedValue.includes('\n')) {
      return `"${protectedValue.replace(/"/g, '""')}"`;
    }
    return protectedValue;
  }

  async importFromCSV(content: string): Promise<{ success: number; errors: string[] }> {
    const lines = content.split(/\r?\n/);
    const headers = this.parseCSVLine(lines[0]);

    const result = { success: 0, errors: [] as string[] };

    const existingProjects = await this.plugin.dataService.getAllProjects();
    const projectByName = new Map(existingProjects.map((p) => [p.name, p]));

    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;

      try {
        const values = this.parseCSVLine(lines[i]);
        const rowData: Record<string, string> = {};

        headers.forEach((header, index) => {
          rowData[header] = values[index] || '';
        });

        const projectName = rowData['项目名称'];
        if (!projectName) {
          result.errors.push(`第 ${i + 1} 行: 缺少项目名称`);
          continue;
        }

        // 解析 APP/版本关联
        const appVersionLinks = await this.parseAppVersionLinks(rowData['关联APP/版本'] || '');

        const existingProject = projectByName.get(projectName);

        const projectData = {
          name: projectName,
          appVersionLinks,
          manager: rowData['项目经理'] || '',
          projectLink: rowData['项目链接'] || '',
          componentLink: rowData['组件库链接'] || '',
          features: rowData['特性'] || '',
          requirements: (rowData['项目需求'] || '').replace(/\\n/g, '\n'),
          progress: this.parseProgress(rowData['项目进度']),
          actualReleaseTime: rowData['实际发布时间'] || '',
        };

        if (existingProject) {
          await this.plugin.dataService.updateProject(existingProject.id, projectData);
        } else {
          const created = await this.plugin.dataService.createProject(projectData);
          projectByName.set(created.name, created);
        }

        result.success++;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        result.errors.push(`第 ${i + 1} 行: ${errorMessage}`);
      }
    }

    return result;
  }

  private parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }

    result.push(current);
    return result;
  }

  /** 解析 "APP-A/v1.0; APP-B/v2.0" 格式的字符串为 ProjectLink 数组 */
  private async parseAppVersionLinks(input: string): Promise<ProjectLink[]> {
    if (!input.trim()) return [];

    const links: ProjectLink[] = [];
    const allApps = await this.plugin.dataService.getAllApps();
    const allVersions = await this.plugin.dataService.getAllVersions();

    const pairs = input.split(';').map((s) => s.trim()).filter(Boolean);

    for (const pair of pairs) {
      const slashIndex = pair.lastIndexOf('/');
      if (slashIndex <= 0) continue;

      const appName = pair.slice(0, slashIndex).trim();
      const versionNumber = pair.slice(slashIndex + 1).trim();

      const app = allApps.find((a) => a.name === appName);
      if (!app) continue;

      const version = allVersions.find((v) => v.appId === app.id && v.versionNumber === versionNumber);
      if (!version) continue;

      // 避免重复关联同一个 APP
      if (!links.some((l) => l.appId === app.id)) {
        links.push({ appId: app.id, versionId: version.id });
      }
    }

    return links;
  }

  private parseProgress(value: string): ProjectProgress {
    const progressOrder = getProgressOrder(this.plugin.settings.progressStages);
    if (progressOrder.includes(value as ProjectProgress)) {
      return value as ProjectProgress;
    }
    return getFirstProgress(this.plugin.settings.progressStages);
  }

  async exportToExcel(projects: Project[], versions: Version[], apps: App[]): Promise<ArrayBuffer> {
    const XLSX = await import('xlsx');

    const appMap = new Map(apps.map((a) => [a.id, a]));
    const versionMap = new Map(versions.map((v) => [v.id, v]));

    const data = projects.map((project) => {
      const appVersionStr = project.appVersionLinks
        .map((link) => {
          const app = appMap.get(link.appId);
          const version = versionMap.get(link.versionId);
          const appName = app?.name || '(未知)';
          const verName = version?.versionNumber || '(未知)';
          return `${appName}/${verName}`;
        })
        .join('; ');

      return {
        项目名称: project.name,
        关联APP版本: appVersionStr,
        项目经理: project.manager,
        项目链接: project.projectLink,
        组件库链接: project.componentLink,
        特性: project.features || '',
        项目需求: project.requirements || '',
        项目进度: project.progress,
        B1集成测试时间: project.b1IntegrationTestTime,
        B1系统测试时间: project.b1SystemTestTime,
        B2集成测试时间: project.b2IntegrationTestTime,
        B2系统测试时间: project.b2SystemTestTime,
        B3集成测试时间: project.b3IntegrationTestTime,
        B3系统测试时间: project.b3SystemTestTime,
        B4集成测试时间: project.b4IntegrationTestTime,
        B4系统测试时间: project.b4SystemTestTime,
        实际发布时间: project.actualReleaseTime,
        创建时间: project.createdAt,
        更新时间: project.updatedAt,
      };
    });

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Projects');

    return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  }

  async importFromExcel(buffer: ArrayBuffer): Promise<{ success: number; errors: string[] }> {
    const XLSX = await import('xlsx');

    const wb = XLSX.read(buffer, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(ws) as Record<string, any>[];

    const result = { success: 0, errors: [] as string[] };

    const existingProjects = await this.plugin.dataService.getAllProjects();
    const projectByName = new Map(existingProjects.map((p) => [p.name, p]));

    for (let i = 0; i < data.length; i++) {
      const row = data[i];

      try {
        const projectName = row['项目名称'];
        if (!projectName) {
          result.errors.push(`第 ${i + 2} 行: 缺少项目名称`);
          continue;
        }

        const appVersionLinks = await this.parseAppVersionLinks(row['关联APP版本'] || '');

        const existingProject = projectByName.get(projectName);

        const projectData = {
          name: projectName,
          appVersionLinks,
          manager: row['项目经理'] || '',
          projectLink: row['项目链接'] || '',
          componentLink: row['组件库链接'] || '',
          features: row['特性'] || '',
          requirements: row['项目需求'] || '',
          progress: this.parseProgress(row['项目进度']),
          actualReleaseTime: row['实际发布时间'] || '',
        };

        if (existingProject) {
          await this.plugin.dataService.updateProject(existingProject.id, projectData);
        } else {
          const created = await this.plugin.dataService.createProject(projectData);
          projectByName.set(created.name, created);
        }

        result.success++;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        result.errors.push(`第 ${i + 2} 行: ${errorMessage}`);
      }
    }

    return result;
  }

  async exportToJson(projects: Project[], versions: Version[], apps: App[]): Promise<string> {
    if (!Array.isArray(projects) || !Array.isArray(versions)) {
      return '[]';
    }

    const appMap = new Map(apps.map((a) => [a.id, a]));
    const versionMap = new Map(versions.map((v) => [v.id, v]));

    const data: ExportProjectJson[] = projects.map((project) => {
      const appVersionStr = project.appVersionLinks
        .map((link) => {
          const app = appMap.get(link.appId);
          const version = versionMap.get(link.versionId);
          const appName = app?.name || '(未知)';
          const verName = version?.versionNumber || '(未知)';
          return `${appName}/${verName}`;
        })
        .join('; ');

      return {
        projectName: project.name,
        appVersions: appVersionStr,
        manager: project.manager,
        projectLink: project.projectLink,
        componentLink: project.componentLink,
        features: project.features || '',
        requirements: project.requirements || '',
        progress: project.progress,
        b1IntegrationTestTime: project.b1IntegrationTestTime,
        b1SystemTestTime: project.b1SystemTestTime,
        b2IntegrationTestTime: project.b2IntegrationTestTime,
        b2SystemTestTime: project.b2SystemTestTime,
        b3IntegrationTestTime: project.b3IntegrationTestTime,
        b3SystemTestTime: project.b3SystemTestTime,
        b4IntegrationTestTime: project.b4IntegrationTestTime,
        b4SystemTestTime: project.b4SystemTestTime,
        actualReleaseTime: project.actualReleaseTime,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      };
    });

    return JSON.stringify(data, null, 2);
  }

  /** 导出待办为 CSV（当前筛选结果） */
  async exportTodosToCSV(todos: Todo[], categories: Category[], projectNameMap: Map<string, string>): Promise<string> {
    const STATUS_LABELS: Record<string, string> = {
      todo: '待完成',
      done: '已完成',
    };
    const PRIORITY_LABELS: Record<string, string> = {
      high: '高',
      medium: '中',
      low: '低',
      '': '无',
    };

    const headers = [
      '内容',
      '状态',
      '优先级',
      '分类',
      '关联项目',
      '截止日期',
      '链接',
      '创建时间',
      '完成时间',
    ];

    const rows = todos.map((todo) => {
      const cat = todo.categoryId ? categories.find((c) => c.id === todo.categoryId) : null;
      return [
        todo.content,
        STATUS_LABELS[todo.status] || todo.status,
        PRIORITY_LABELS[todo.priority] || '',
        cat?.name || '',
        todo.projectId ? projectNameMap.get(todo.projectId) || '' : '',
        todo.dueDate || '',
        todo.link || '',
        todo.createdAt || '',
        todo.completedAt || '',
      ];
    });

    const csvContent = [headers.join(','), ...rows.map((row) => row.map((cell) => this.escapeCSV(cell)).join(','))].join('\n');
    return csvContent;
  }
}
