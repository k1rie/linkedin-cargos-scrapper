const axios = require('axios');

const CLICKUP_API_TOKEN = process.env.CLICKUP_API_TOKEN;
const CLICKUP_LIST_ID = process.env.CLICKUP_LIST_ID || '901708880354';
const CLICKUP_RESULTS_ID = process.env.CLICKUP_RESULTS_ID;
const CLICKUP_BASE_URL = 'https://api.clickup.com/api/v2';

const getJobTitles = async () => {
  try {
    const response = await axios.get(
      `${CLICKUP_BASE_URL}/list/${CLICKUP_LIST_ID}/task`,
      {
        headers: {
          'Authorization': CLICKUP_API_TOKEN,
          'Content-Type': 'application/json'
        },
        params: {
          archived: false
        }
      }
    );

    return response.data.tasks.map(task => ({
      id: task.id,
      title: task.name,
      status: task.status?.status,
      listId: task.list?.id || CLICKUP_LIST_ID
    }));
  } catch (error) {
    console.error('Error fetching job titles from ClickUp:', error.response?.data || error.message);
    throw new Error(`Failed to fetch job titles: ${error.message}`);
  }
};

const createPersonTask = async (person, jobTitleId, companyName, jobTitle) => {
  try {
    const taskName = `${person.name} - ${jobTitle}`;
    
    const description = `
**Perfil de LinkedIn**
- **Nombre:** ${person.name}
- **Cargo:** ${person.title || 'N/A'}
- **Empresa:** ${companyName}
- **Ubicación:** ${person.location || 'N/A'}
- **Link:** ${person.profileUrl}

**Información de búsqueda:**
- Cargo buscado: ${jobTitle}
- Empresa buscada: ${companyName}
    `.trim();

    const response = await axios.post(
      `${CLICKUP_BASE_URL}/list/${CLICKUP_LIST_ID}/task`,
      {
        name: taskName,
        description: description,
        status: 'to do',
        priority: null,
        due_date: null,
        due_date_time: false,
        parent: jobTitleId,
        time_estimate: null,
        start_date: null,
        start_date_time: false,
        notify_all: false,
        check_required_custom_fields: false
      },
      {
        headers: {
          'Authorization': CLICKUP_API_TOKEN,
          'Content-Type': 'application/json'
        }
      }
    );

    return response.data;
  } catch (error) {
    console.error('=== ClickUp Create Task Error ===');
    console.error('Status:', error.response?.status);
    console.error('Response Data:', JSON.stringify(error.response?.data, null, 2));
    console.error('Error Message:', error.message);
    console.error('=================================');
    throw new Error(`Failed to create task in ClickUp: ${error.message}`);
  }
};

/**
 * Create a person task in the results list (no parent, no organization by job title)
 */
const createPersonResult = async (person, companyName, jobTitle) => {
  try {
    if (!CLICKUP_RESULTS_ID) {
      throw new Error('CLICKUP_RESULTS_ID not configured in .env');
    }

    const taskName = `${person.name}${person.title ? ` - ${person.title}` : ''}`;
    
    const description = `
**Perfil de LinkedIn**
- **Nombre:** ${person.name}
- **Cargo:** ${person.title || 'N/A'}
- **Empresa actual:** ${person.company || companyName}
- **Ubicación:** ${person.location || 'N/A'}
- **Link:** ${person.profileUrl}

**Información de búsqueda:**
- Cargo buscado: ${jobTitle}
- Empresa buscada: ${companyName}
    `.trim();

    const response = await axios.post(
      `${CLICKUP_BASE_URL}/list/${CLICKUP_RESULTS_ID}/task`,
      {
        name: taskName,
        description: description,
        status: 'to do',
        priority: null,
        due_date: null,
        due_date_time: false,
        parent: null, // No parent - direct task in results list
        time_estimate: null,
        start_date: null,
        start_date_time: false,
        notify_all: false,
        check_required_custom_fields: false
      },
      {
        headers: {
          'Authorization': CLICKUP_API_TOKEN,
          'Content-Type': 'application/json'
        }
      }
    );

    return response.data;
  } catch (error) {
    console.error('=== ClickUp Create Result Error ===');
    console.error('Status:', error.response?.status);
    console.error('Response Data:', JSON.stringify(error.response?.data, null, 2));
    console.error('Error Message:', error.message);
    console.error('=================================');
    throw new Error(`Failed to create result in ClickUp: ${error.message}`);
  }
};

/**
 * Check if a person already exists in the results list
 */
const checkPersonExistsInResults = async (personUrl) => {
  try {
    if (!CLICKUP_RESULTS_ID) {
      // If results list not configured, skip check
      return false;
    }

    const response = await axios.get(
      `${CLICKUP_BASE_URL}/list/${CLICKUP_RESULTS_ID}/task`,
      {
        headers: {
          'Authorization': CLICKUP_API_TOKEN,
          'Content-Type': 'application/json'
        },
        params: {
          archived: false,
          include_markdown_description: true
        }
      }
    );

    const tasks = response.data.tasks || [];
    
    // Buscar en todas las tareas de la lista de resultados
    for (const task of tasks) {
      const description = task.description || '';
      if (description.includes(personUrl)) {
        return true;
      }
    }
    
    return false;
  } catch (error) {
    console.error('Error checking if person exists in results:', error.message);
    return false;
  }
};

const checkPersonExists = async (personUrl, jobTitleId) => {
  try {
    // Primero verificar en la lista de resultados
    const existsInResults = await checkPersonExistsInResults(personUrl);
    if (existsInResults) {
      return true;
    }

    // También verificar en la lista original (por si acaso)
    const response = await axios.get(
      `${CLICKUP_BASE_URL}/list/${CLICKUP_LIST_ID}/task`,
      {
        headers: {
          'Authorization': CLICKUP_API_TOKEN,
          'Content-Type': 'application/json'
        },
        params: {
          archived: false,
          subtasks: true,
          include_markdown_description: true
        }
      }
    );

    const tasks = response.data.tasks || [];
    
    // Buscar en todas las tareas y sus subtareas
    for (const task of tasks) {
      // Verificar si es subtarea del cargo buscado
      if (task.parent?.id === jobTitleId || task.id === jobTitleId) {
        // Verificar en la descripción de esta tarea
        const description = task.description || '';
        if (description.includes(personUrl)) {
          return true;
        }
        
        // Si esta tarea tiene subtareas, verificar también
        if (task.subtasks && task.subtasks.length > 0) {
          for (const subtask of task.subtasks) {
            const subtaskDesc = subtask.description || '';
            if (subtaskDesc.includes(personUrl)) {
              return true;
            }
          }
        }
      }
    }
    
    return false;
  } catch (error) {
    console.error('Error checking if person exists:', error.message);
    return false;
  }
};

module.exports = {
  getJobTitles,
  createPersonTask,
  createPersonResult, // Nueva función para guardar en lista de resultados
  checkPersonExists,
  checkPersonExistsInResults
};

